import { test } from "node:test";
import { strict as assert } from "node:assert";

import { Project } from "../Project.js";

test("eval: simple", (t) =>
{
    let proj = new Project();
    assert.equal(proj.eval(true), true);
    assert.equal(proj.eval(42), 42);
    assert.equal(proj.eval("hello"), "hello");
    assert.deepEqual(proj.eval(["a", "b", "c"]), [ "a", "b", "c" ]);
});

test("eval: callback", (t) =>
{
    let proj = new Project();
    assert.equal(proj.eval(() => true), true);
    assert.equal(proj.eval(() => 42), 42);
    assert.equal(proj.eval(() => "hello"), "hello");
    assert.deepEqual(proj.eval(() => [() => "a", () => "b", () => "c"]), [ "a", "b", "c" ]);
});

test("eval: expand", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World"
    });
    assert.equal(proj.eval("$(greeting) $(subject)"), "Hello World");
});

test("eval: expand callback", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World"
    });
    assert.equal(proj.eval(() => "$(greeting) $(subject)"), "Hello World");
});

test("eval: flatten", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World"
    });
    assert.deepEqual(proj.eval([[1,2,3],[4,["$(greeting)",() => "$(subject)"]],[7,8]]), [1,2,3,4,"Hello","World",7,8]);
});

test("resolve: simple", (t) =>
{
    let proj = new Project();
    proj.define({
        boolVal: true,
        numVal: 42,
        strVal: "hello",
        arrVal: [ "a", "b", "c" ],  
    });

    assert.equal(proj.resolve("boolVal"), true);
    assert.equal(proj.resolve("numVal"), 42);
    assert.equal(proj.resolve("strVal"), "hello");
    assert.deepEqual(proj.resolve("arrVal"), [ "a", "b", "c" ]);
});

test("resolve: expand", (t) =>
{
    let proj = new Project();
    proj.define({
        val: "$(otherVal)",
        otherVal: "Hello World",
    });

    assert.equal(proj.resolve("val"), "Hello World");
});

test("resolve: expand recursive", (t) =>
{
    let proj = new Project();
    proj.define({
        val: "$(otherVal)",
        otherVal: "$(greeting) World",
        greeting: "Hello"
    });

    assert.equal(proj.resolve("val"), "Hello World");
});

test("resolve: expand multiple", (t) =>
{
    let proj = new Project();
    proj.define({
        val: "$(otherVal)",
        otherVal: "$(greeting) $(subject)",
        greeting: "Hello",
        subject: "World"
    });

    assert.equal(proj.resolve("val"), "Hello World");
});
