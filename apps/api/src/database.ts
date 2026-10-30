import mongoose from "mongoose";

export interface Database {
  readonly connection: mongoose.Connection;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

export class DatabaseConnectionError extends Error {
  constructor() {
    super("MongoDB connection failed");
    this.name = "DatabaseConnectionError";
  }
}

export async function connectDatabase(uri: string): Promise<Database> {
  const connection = mongoose.createConnection();
  // Connection state and readiness probes handle errors. Never serialize driver
  // errors: their messages/topology can contain credentials or connection URLs.
  connection.on("error", () => {});

  try {
    await connection.openUri(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      heartbeatFrequencyMS: 1000,
      maxPoolSize: 10,
      minPoolSize: 0,
      bufferCommands: false,
      autoCreate: false,
      autoIndex: false,
    });
  } catch {
    await connection.close().catch(() => {});
    throw new DatabaseConnectionError();
  }

  let closing = false;
  return {
    connection,
    async isReady() {
      if (closing || connection.readyState !== 1 || !connection.db) return false;
      try {
        await connection.db.command({ ping: 1 }, { timeoutMS: 1000 });
        return !closing && connection.readyState === 1;
      } catch {
        return false;
      }
    },
    async close() {
      closing = true;
      await connection.close();
    },
  };
}
