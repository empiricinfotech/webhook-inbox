import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Types } from "mongoose";
import { expect } from "vitest";
import { test } from "../helpers/api-fixture.js";
import { runLocalInbox } from "../helpers/local-inbox-command.js";
import { createCaptureTokenCrypto } from "../../apps/api/src/security/capture-token.js";
import { createCaptureTokenService } from "../../apps/api/src/services/capture-tokens.js";

async function directory(cleanup: (callback: () => Promise<void>) => void) {
  const path = await mkdtemp(join(tmpdir(), "webhook-local-command-"));
  cleanup(() => rm(path, { force: true, recursive: true }));
  return path;
}

test("operator init creates a private random config once, refuses replacement and prints no key", async ({ onTestFinished }) => {
  const path = await directory(onTestFinished);
  const result = await runLocalInbox(path, ["init"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ data: { status: "local_config_created" } });
  const file = join(path, ".env.inbox.local");
  const content = await readFile(file, "utf8");
  const key = content.match(/^CAPTURE_TOKEN_KEY_HEX=([0-9a-f]{64})$/m)?.[1];
  expect(typeof key === "string").toBe(true);
  expect(result.stdout.includes(key!)).toBe(false);
  expect(result.stderr.includes(key!)).toBe(false);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  const again = await runLocalInbox(path, ["init"]);
  expect(again.code).toBe(1);
  expect(again.stderr.includes('"code":"CONFIG_ALREADY_EXISTS"')).toBe(true);
  expect(await readFile(file, "utf8") === content).toBe(true);
});

test("actual operator process bootstraps, creates and lists against owned Mongo, without public routes or secret output", async ({ mongo, onTestFinished }) => {
  const path = await directory(onTestFinished);
  const key = randomBytes(32);
  const ownerId = new Types.ObjectId(), workspaceId = new Types.ObjectId();
  await writeFile(join(path, ".env.inbox.local"), ["NODE_ENV=test", `MONGODB_URI=${mongo.uri}`,
    `LOCAL_OWNER_ID=${ownerId.toHexString()}`, `LOCAL_WORKSPACE_ID=${workspaceId.toHexString()}`,
    "LOCAL_WORKSPACE_NAME=Synthetic operator workspace", "CAPTURE_TOKEN_KEY_VERSION=test-v1",
    `CAPTURE_TOKEN_KEY_HEX=${key.toString("hex")}`, ""].join("\n"), { mode: 0o600 });
  const outputs: string[] = [];
  for (const args of [["bootstrap"], ["bootstrap"], ["list"], ["create", "Synthetic operator inbox", "Synthetic description"], ["list"]]) {
    const result = await runLocalInbox(path, args);
    expect(result.code).toBe(0);
    expect(result.stdout.includes(key.toString("hex"))).toBe(false);
    outputs.push(result.stdout + result.stderr);
  }
  expect(await mongo.connection.collection("workspaces").countDocuments()).toBe(1);
  expect(await mongo.connection.collection("inboxes").countDocuments()).toBe(1);
  const raw = await mongo.connection.collection("inboxes").findOne({ workspaceId });
  const tokens = createCaptureTokenService(mongo.connection, createCaptureTokenCrypto({ currentVersion: "test-v1", keys: new Map([["test-v1", key]]) }));
  const token = await tokens.retrieveForOwner({ actorId: ownerId, workspaceId, inboxId: raw!._id });
  expect(outputs.every((output) => !output.includes(token) && !output.includes(raw!.tokenHash) && !output.includes(raw!.encryptedToken.ciphertext))).toBe(true);
  const listed = JSON.parse(outputs[4]!.split("\n")[0]!);
  expect(listed.data[0].name).toBe("Synthetic operator inbox");
});

test("operator rejects missing/production config and bad arguments without reflecting secrets or touching Mongo", async ({ mongo, onTestFinished }) => {
  const path = await directory(onTestFinished);
  const privateValue = randomBytes(32).toString("hex");
  for (const [args, env] of [
    [["bootstrap"], {}], [["bootstrap"], { NODE_ENV: "production", MONGODB_URI: mongo.uri, CAPTURE_TOKEN_KEY_HEX: privateValue }],
    [["unknown", privateValue], {}], [["list", privateValue], {}], [["create"], {}],
  ] as [string[], Record<string, string>][]) {
    const result = await runLocalInbox(path, args, env);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.includes(privateValue)).toBe(false);
  }
  expect(await mongo.connection.collection("workspaces").countDocuments()).toBe(0);
  expect(await mongo.connection.collection("inboxes").countDocuments()).toBe(0);
});
