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
    mtime(filename)
    {
        if (filename === "test.c")
            return 1000;
        return 0;
    }   
}

test("no build rule, file doesn't exist", (t) =>
{
    let proj = new MockProject();
    assert.throws(() => proj.buildFile("test.exe"), /No rule/);
});

test("no build rule, file does exist", (t) =>
{
    let proj = new MockProject();
    let plan = proj.generatePlan("test.c");
    assert.deepEqual(plan, []);
});

test("simple rule", (t) =>
{
    let proj = new MockProject();
    proj.rule({
        output: "test.obj",
        input: "test.c",
        action: function compile(rule) { }
    }); 

    let plan = proj.generatePlan("test.obj");

    assert.deepEqual(plan.map(ruleToString), [
        'test.obj : test.c : compile()',
    ]);
});

test("chained rules", (t) =>
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

    let plan = proj.generatePlan("test.exe");

    assert.deepEqual(plan.map(ruleToString), [
        'test.obj : test.c : compile()',
        'test.exe : test.obj : link()',
    ]);
});

test("inferred rule", (t) =>
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

    let plan = proj.generatePlan("test.exe");

    assert.deepEqual(plan.map(ruleToString), [
        'test.obj : test.c : compile()',
        'test.exe : test.obj : link()',
    ]);
});

test("multiple inferred rule", (t) =>
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

    let plan = proj.generatePlan("test.obj");

    assert.deepEqual(plan.map(ruleToString), [
        'test.obj : test.c : compileC()',
    ]);
});

