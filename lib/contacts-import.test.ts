import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapHeaders,
  missingRequiredFields,
  hasContactChannel,
  normalizeCell,
  normalizeEmail,
  normalizeBirthdate,
  normalizeRow,
} from "./contacts-import";

test("mapHeaders matches District 23 style headers", () => {
  const mapping = mapHeaders([
    "Voters_FirstName",
    "Voters_LastName",
    "email1",
    "VoterTelephones_CellPhoneUnformatted",
    "Unknown_Column",
  ]);
  assert.equal(mapping["Voters_FirstName"], "first_name");
  assert.equal(mapping["email1"], "email");
  assert.equal(mapping["Unknown_Column"], null);
});

test("mapHeaders also matches plainer header styles, case/space-insensitive", () => {
  const mapping = mapHeaders(["First Name", "last name", "Email Address", "Cell Phone"]);
  assert.equal(mapping["First Name"], "first_name");
  assert.equal(mapping["last name"], "last_name");
  assert.equal(mapping["Email Address"], "email");
  assert.equal(mapping["Cell Phone"], "cell");
});

test("missingRequiredFields flags a file with no name columns", () => {
  const mapping = mapHeaders(["email1"]);
  assert.deepEqual(missingRequiredFields(mapping), ["first_name", "last_name"]);
});

test("hasContactChannel requires an email or cell column", () => {
  assert.equal(hasContactChannel(mapHeaders(["First Name", "Last Name"])), false);
  assert.equal(hasContactChannel(mapHeaders(["First Name", "email1"])), true);
});

test("normalizeCell accepts 10 and 11 digit US numbers, rejects the rest", () => {
  assert.equal(normalizeCell("410-555-0101"), "+14105550101");
  assert.equal(normalizeCell("14105550101"), "+14105550101");
  assert.equal(normalizeCell("555-0101"), null);
  assert.equal(normalizeCell(undefined), null);
});

test("normalizeEmail lowercases and rejects malformed addresses", () => {
  assert.equal(normalizeEmail("Pat@Example.COM"), "pat@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("normalizeBirthdate handles M/D/YYYY and drops year-only placeholders", () => {
  assert.equal(normalizeBirthdate("3/4/1990"), "1990-03-04");
  assert.equal(normalizeBirthdate("1/1/9999"), null);
});

test("normalizeRow drops rows with neither email nor cell", () => {
  const mapping = mapHeaders(["First Name", "Last Name"]);
  const row = normalizeRow({ "First Name": "Pat", "Last Name": "Lee" }, mapping);
  assert.equal(row, null);
});

test("normalizeRow keeps a row with just an email", () => {
  const mapping = mapHeaders(["First Name", "Last Name", "email1"]);
  const row = normalizeRow({ "First Name": "Pat", "Last Name": "Lee", email1: "Pat@Example.com" }, mapping);
  assert.equal(row?.email, "pat@example.com");
  assert.equal(row?.cell_e164, null);
});
