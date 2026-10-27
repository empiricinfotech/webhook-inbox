import type { MongoFixture } from "../helpers/mongo-fixture.js";

// Harness records, not future workspace/inbox/event models.
export async function seedSyntheticRecords(mongo: MongoFixture) {
  const records = [{ label: "Synthetic alpha", value: 1 }, { label: "Synthetic beta", value: 2 }];
  await mongo.connection.collection("harness_records").insertMany(records);
  return records;
}
