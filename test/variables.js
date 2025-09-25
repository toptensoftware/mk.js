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
    assert.deepEqual(proj.eval([[1,2,3],[4,["$(greeting)",() => "$(subject)"]],[7,8]]), [[1,2,3],[4,["Hello","World"]],[7,8]]);
});

test("prop: simple", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello World",
    });
    assert.equal(proj.greeting, "Hello World");
});


test("prop: callback", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: () => `${proj.greeting} ${proj.subject}`
    });
    assert.equal(proj.message, "Hello World");
});

test("prop: expand", (t) =>
{
    let proj = new Project();
    proj.define({
        recursive: "Hello",
        greeting: "$(recursive)",
        subject: "World",
        intVal: 43,
        boolVal: false,
        arrayVal: [ "a", "b", "c d", [ 11, true ] ],
        message: "$(greeting) $(subject) $(intVal) $(boolVal) $(arrayVal)"
    });
    assert.equal(proj.message, 'Hello World 43 false a b "c d" 11 true');
});

test("prop: callback with this", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: function() { return `${this.greeting} ${this.subject}` }
    });
    assert.equal(proj.message, "Hello World");
});

test("prop: redefine property", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: "${greeting} ${subject}",
    });
    proj.define({
        message: () => `${proj.greeting} ${proj.subject}!!!`,
    });
    assert.equal(proj.message, "Hello World!!!");
});


test("prop: expand arrays", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: [ "$(greeting)", "$(subject)" ],
    });
    assert.deepEqual(proj.message, [ "Hello", "World" ]);
})

test("prop: expand arrays from callbacks", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: () => [ "$(greeting)", [ "$(subject)", "!!!" ] ],
    });
    assert.deepEqual(proj.message, [ "Hello", [ "World", "!!!" ] ]);
})


test("prop: props on other objects", (t) =>
{
    let proj = new Project();
    proj.define({
        greeting: "Hello",
        subject: "World",
    });

    let other = {
        punct: "!!!",
    }

    proj.createProperty(other, "message", function(p) { 
        // 'this' refers to 'other' object
        // 'p' refers to the project the property was created through
        // $(vars) are expanded against the project
        return `${p.greeting} $(subject)${this.punct}`;
    });

    assert.equal(other.message, "Hello World!!!");
})
