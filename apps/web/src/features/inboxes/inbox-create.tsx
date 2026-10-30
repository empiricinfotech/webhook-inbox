"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createInboxSchema, INBOX_NAME_MAX_LENGTH, INBOX_DESCRIPTION_MAX_LENGTH } from "@empiric-webhook-inbox/contracts/inboxes";
import { createInbox as saveInbox } from "./api";
import { InboxFailure, LoadingInbox, useLocalWorkspace } from "./shared";

export function InboxCreate() {
  const workspace = useLocalWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const nameField = useRef<HTMLInputElement>(null);
  const descriptionField = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: { name: string; description: string }) => saveInbox(workspace.data!.data.id, input), retry: false,
    onSuccess: async ({ data }) => {
      queryClient.setQueryData(["inbox", workspace.data!.data.id, data.id], { data });
      await queryClient.invalidateQueries({ queryKey: ["inboxes", workspace.data!.data.id] });
      router.push(`/inboxes/${data.id}`);
    },
  });
  if (workspace.isError && !workspace.data) return <InboxFailure error={workspace.error} retry={() => void workspace.refetch()} />;
  if (!workspace.data) return <LoadingInbox message="Loading your workspace…" />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const values = new FormData(event.currentTarget);
    const parsed = createInboxSchema.safeParse({ name: values.get("name"), description: values.get("description") });
    if (!parsed.success) {
      const next = {
        name: parsed.error.issues.some((issue) => issue.path[0] === "name") ? "Enter a name of 1–100 characters, without control characters." : undefined,
        description: parsed.error.issues.some((issue) => issue.path[0] === "description") ? "Use at most 500 characters without unsafe control characters." : undefined,
      };
      setErrors(next);
      (next.name ? nameField : descriptionField).current?.focus();
      return;
    }
    setErrors({});
    inFlight.current = true;
    try { await mutation.mutateAsync({ name: parsed.data.name, description: parsed.data.description }); }
    catch { /* Mutation state presents the safe error without discarding the form. */ }
    finally { inFlight.current = false; }
  }
  return <section className="panel inbox-form-panel">
    <p className="muted">{workspace.data.data.name}</p>
    <form noValidate onSubmit={(event) => void submit(event)} aria-busy={mutation.isPending}>
      <div className="form-field"><label htmlFor="inbox-name">Inbox name <span className="muted">(required)</span></label>
        <input ref={nameField} id="inbox-name" name="name" required maxLength={INBOX_NAME_MAX_LENGTH} autoComplete="off"
          placeholder="e.g. GitHub staging" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : "name-hint"} />
        {errors.name ? <p className="field-error" id="name-error" role="alert">{errors.name}</p> : <p className="field-hint" id="name-hint">A short name to recognize your integration. Up to 100 characters.</p>}
      </div>
      <div className="form-field"><label htmlFor="inbox-description">Description <span className="muted">(optional)</span></label>
        <textarea ref={descriptionField} id="inbox-description" name="description" rows={4} maxLength={INBOX_DESCRIPTION_MAX_LENGTH}
          placeholder="What will you test here?" aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "description-error" : "description-hint"} />
        {errors.description ? <p className="field-error" id="description-error" role="alert">{errors.description}</p> : <p className="field-hint" id="description-hint">Up to 500 characters. Keep credentials and real webhook data out.</p>}
      </div>
      <p className="notice">New inboxes are enabled with 7-day retention. Capture is not available yet.</p>
      {mutation.isError ? <div className="form-error" role="alert"><p>{mutation.error.message}</p>
        <p>Your input is preserved. Check the inbox list before retrying; creation may have succeeded if the connection was interrupted.</p>
        <Link href="/inboxes">Check inbox list</Link></div> : null}
      <div className="inbox-actions form-actions"><button className="button" type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Creating inbox…" : "Create inbox"}</button><Link href="/inboxes">Cancel</Link></div>
    </form>
  </section>;
}
