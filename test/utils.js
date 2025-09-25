import { test } from "node:test";
import { strict as assert } from "node:assert";

import { quotedJoin, quotedSplit, cache } from "../utils.js";

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

test("quoted: once", (t) => {

    let val = 1;
    let fn = cache(() => val++);

    let result1 = fn();
    let result2 = fn();

    assert.equal(result1, result2);

    fn.flush();
    let result3 = fn();
    let result4 = fn();
    assert.notEqual(result3, result1);
    assert.equal(result3, result4);

}); 