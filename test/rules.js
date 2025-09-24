import { test } from "node:test";
import { strict as assert } from "node:assert";

import { toString, quotedJoin } from "../utils.js";
import { Project } from "../Project.js";

function ruleToString(rule)
{
    return toString(rule.output) + " : " + quotedJoin(rule.input) + " : " + rule.action[0].name + "()";
}

class MockProject extends Project
{
    constructor()
    {
        super();
        this.on("willbuildTarget", (filename, mrule) => {
            this.results.push(ruleToString(mrule));
        });
        this.on("skipFile", (filename) => {
            this.results.push(`skipping ${filename}`);
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
    await assert.rejects(async () => proj.buildTarget("test.exe"), /No rule/);
});

test("no rules, file does exist", async (t) =>
{
    let proj = new MockProject();
    assert.equal(await proj.buildTarget("test.c"), false);
    assert.deepEqual(proj.results, []);
});

test("simple rule", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "test.obj",
        input: "test.c",
        action: function compileC() {},
    }); 

    assert.equal(await proj.buildTarget("test.obj"), true);

    assert.deepEqual(proj.results, [
        'test.obj : test.c : compileC()',
    ]);
});

test("chained rules", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "test.obj",
        input: "test.c",
        action: function compile(rule) { }
    }); 
    proj.rule({
        output: "test.exe",
        input: "test.obj",
        action: function link(rule) { }
    }); 

    assert.equal(await proj.buildTarget("test.exe"), true);

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
        input: "%.c",
        action: function compile(rule) { }
    }); 
    proj.rule({
        output: "%.exe",
        input: "%.obj",
        action: function link(rule) { }
    }); 

    assert.equal(await proj.buildTarget("test.exe"), true);

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
        input: "%.c",
        action: function compileC(rule) { }
    }); 
    proj.rule({
        output: "%.obj",
        input: "%.cpp",
        action: function compileCPP(rule) { }
    }); 

    assert.equal(await proj.buildTarget("test.obj"), true);

    assert.deepEqual(proj.results, [
        'test.obj : test.c : compileC()',
    ]);
});

test("conflicting multiple inferred rules", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "%.obj",
        input: "%.c",
        action: function compileC(rule) { }
    }); 
    proj.rule({
        output: "%.obj",
        input: "%.c",
        action: function compileC(rule) { }
    }); 

    await assert.rejects(async() => await proj.buildTarget("test.obj"), /Multiple inferred rules/);
});

test("build if output missing", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "missing.obj",
        input: "test.c",
        action: function compileC(rule) { }
    }); 

    await proj.buildTarget("missing.obj");

    assert.deepEqual(proj.results, [
        "missing.obj : test.c : compileC()",
    ]);
});

test("skip if up to date", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "up-to-date.obj",
        input: "up-to-date.c",
        action: function compileC(rule) { }
    }); 

    await proj.buildTarget("up-to-date.obj");

    assert.deepEqual(proj.results, [
        'skipping up-to-date.obj',
    ]);
});

test("build if out of date", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "out-of-date.obj",
        input: "out-of-date.c",
        action: function compileC(rule) { }
    }); 

    await proj.buildTarget("out-of-date.obj");

    assert.deepEqual(proj.results, [
        "out-of-date.obj : out-of-date.c : compileC()",
    ]);
});


test("only build target once", async (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "out-of-date.obj",
        input: "out-of-date.c",
        action: function compileC(rule) { }
    }); 

    await proj.buildTarget("out-of-date.obj");
    await proj.buildTarget("out-of-date.obj");
    await proj.buildTarget("out-of-date.obj");

    assert.deepEqual(proj.results, [
        "out-of-date.obj : out-of-date.c : compileC()",
    ]);
});

