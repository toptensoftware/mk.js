import { test } from "node:test";
import { strict as assert } from "node:assert";

import { quotedJoin, quotedSplit } from "../utils.js";

test("quoted: join", (t) =>
{
    let arr = ["simple", 'test "again"'];
    let joined = quotedJoin(arr);
    assert.equal(joined, 'simple "test ""again"""');
});

test("quoted: split", (t) =>
{
    let joined = 'simple "test ""again"""';
    let split = quotedSplit(joined);
    assert.deepEqual(split, ["simple", 'test "again"']);
});