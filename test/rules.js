import { test } from "node:test";
import { strict as assert } from "node:assert";

import { toString, quotedJoin } from "../utils.js";
import { Project } from "../Project.js";

function ruleToString(t)
{
    return toString(t.target) + " : " + quotedJoin(t.deps) + " : " + t.rule.action.name + "()";
}

class MockProject extends Project
{
    constructor()
    {
        super();
        this.on("willInvokeRule", (target) => {
            this.results.push(ruleToString(target));
        });
        this.on("skipTarget", (target) => {
            this.results.push(`skipping ${target.target}`);
        });
        this.filetimes = {
            "test.c": 1000,
            "up-to-date.c": 1000,
            "up-to-date.obj": 2000,
            "out-of-date.c": 2000,
            "out-of-date.obj": 1000,
        }
    }
    mtime(filename)
    {
        return this.filetimes[filename] ?? 0;
    }
    results = [];
}

test("no rules, file doesn't exist", async (t) =>
{
    let proj = new MockProject();
    await assert.rejects(async () => proj.make("test.exe"), /No rule/);
});

test("no rules, file does exist", async (t) =>
{
    let proj = new MockProject();
    assert.equal(await proj.make("test.c"), false);
    assert.deepEqual(proj.results, []);
});

test("simple rule", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "test.obj",
        deps: "test.c",
        action: function compileC() {},
    }); 

    assert.equal(await proj.make("test.obj"), true);

    assert.deepEqual(proj.results, [
        'test.obj : test.c : compileC()',
    ]);
});

test("chained rules", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "test.obj",
        deps: "test.c",
        action: function compile(rule) { }
    }); 
    proj.rule({
        output: "test.exe",
        deps: "test.obj",
        action: function link(rule) { }
    }); 

    assert.equal(await proj.make("test.exe"), true);

    assert.deepEqual(proj.results, [
        'test.obj : test.c : compile()',
        'test.exe : test.obj : link()',
    ]);
});

test("inferred rule", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "%.obj",
        deps: "%.c",
        action: function compile(rule) { }
    }); 
    proj.rule({
        output: "%.exe",
        deps: "%.obj",
        action: function link(rule) { }
    }); 

    assert.equal(await proj.make("test.exe"), true);

    assert.deepEqual(proj.results, [
        'test.obj : test.c : compile()',
        'test.exe : test.obj : link()',
    ]);
});

test("choose from multiple inferred rules", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "%.obj",
        deps: "%.c",
        action: function compileC(rule) { }
    }); 
    proj.rule({
        output: "%.obj",
        deps: "%.cpp",
        action: function compileCPP(rule) { }
    }); 

    assert.equal(await proj.make("test.obj"), true);

    assert.deepEqual(proj.results, [
        'test.obj : test.c : compileC()',
    ]);
});

test("conflicting multiple inferred rules", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "%.obj",
        deps: "%.c",
        action: function compileC(rule) { }
    }); 
    proj.rule({
        output: "%.obj",
        deps: "%.c",
        action: function compileC(rule) { }
    }); 

    await assert.rejects(async() => await proj.make("test.obj"), /multiple inferred rules/);
});

test("build if output missing", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "missing.obj",
        deps: "test.c",
        action: function compileC(rule) { }
    }); 

    await proj.make("missing.obj");

    assert.deepEqual(proj.results, [
        "missing.obj : test.c : compileC()",
    ]);
});

test("skip if up to date", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "up-to-date.obj",
        deps: "up-to-date.c",
        action: function compileC(rule) { }
    }); 

    await proj.make("up-to-date.obj");

    assert.deepEqual(proj.results, [
        'skipping up-to-date.obj',
    ]);
});

test("build if out of date", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "out-of-date.obj",
        deps: "out-of-date.c",
        action: function compileC(rule) { }
    }); 

    await proj.make("out-of-date.obj");

    assert.deepEqual(proj.results, [
        "out-of-date.obj : out-of-date.c : compileC()",
    ]);
});


test("only build target once", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "out-of-date.obj",
        deps: "out-of-date.c",
        action: function compileC(rule) { }
    }); 

    await proj.make("out-of-date.obj");
    await proj.make("out-of-date.obj");
    await proj.make("out-of-date.obj");

    assert.deepEqual(proj.results, [
        "out-of-date.obj : out-of-date.c : compileC()",
    ]);
});


test("multiple order", async (t) =>
{
    let proj = new MockProject();

    proj.rule({
        output: "rule",
        order: 2,
        action: function pri2(rule) { }
    }); 

    proj.rule({
        output: "rule",
        order: 1,
        action: function pri1(rule) { }
    }); 

    await proj.make("rule");

    assert.deepEqual(proj.results, [
        "rule :  : pri1()",
        "rule :  : pri2()",
    ]);
});

test("same order, higher priority wins", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "rule",
        order: 1,
        priority: 1,
        action: function first(rule) { }
    }); 
    proj.rule({
        output: "rule",
        order: 1,
        priority: 2,
        action: function second(rule) { }
    }); 

    await proj.make("rule");

    assert.deepEqual(proj.results, [
        "rule :  : second()",
    ]);
});

test("same order, same priority, both explicit", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "rule",
        order: 1,
        priority: 1,
        action: function first(rule) { }
    }); 
    proj.rule({
        output: "rule",
        order: 1,
        priority: 1,
        action: function second(rule) { }
    }); 

    await assert.rejects(async() => await proj.make("rule"), /multiple explicit rules/);
});

test("same order, same priority, both inferred", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "rul%",
        order: 1,
        priority: 1,
        action: function first(rule) { }
    }); 
    proj.rule({
        output: "rul%",
        order: 1,
        priority: 1,
        action: function second(rule) { }
    }); 

    await assert.rejects(async() => await proj.make("rule"), /multiple inferred rules/);
});

test("same order, same priority, explicit wins", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "rul%",
        order: 1,
        priority: 1,
        action: function first(rule) { }
    }); 
    proj.rule({
        output: "rule",
        order: 1,
        priority: 1,
        action: function second(rule) { }
    }); 

    await proj.make("rule");

    assert.deepEqual(proj.results, [
        "rule :  : second()",
    ]);
});

