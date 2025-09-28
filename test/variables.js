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
    proj.set({
        greeting: "Hello",
        subject: "World"
    });
    assert.equal(proj.eval("$(greeting) $(subject)"), "Hello World");
});

test("eval: expand callback", (t) =>
{
    let proj = new Project();
    proj.set({
        greeting: "Hello",
        subject: "World"
    });
    assert.equal(proj.eval(() => "$(greeting) $(subject)"), "Hello World");
});

test("eval: flatten", (t) =>
{
    let proj = new Project();
    proj.set({
        greeting: "Hello",
        subject: "World"
    });
    assert.deepEqual(proj.eval([[1,2,3],[4,["$(greeting)",() => "$(subject)"]],[7,8]]), [[1,2,3],[4,["Hello","World"]],[7,8]]);
});

test("prop: simple", (t) =>
{
    let proj = new Project();
    proj.set({
        greeting: "Hello World",
    });
    assert.equal(proj.greeting, "Hello World");
});


test("prop: callback", (t) =>
{
    let proj = new Project();
    proj.set({
        greeting: "Hello",
        subject: "World",
        message: () => `${proj.greeting} ${proj.subject}`
    });
    assert.equal(proj.message, "Hello World");
});

test("prop: expand", (t) =>
{
    let proj = new Project();
    proj.set({
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
    proj.set({
        greeting: "Hello",
        subject: "World",
        message: function() { return `${this.greeting} ${this.subject}` }
    });
    assert.equal(proj.message, "Hello World");
});

test("prop: redefine property", (t) =>
{
    let proj = new Project();
    proj.set({
        greeting: "Hello",
        subject: "World",
        message: "${greeting} ${subject}",
    });
    proj.set({
        message: () => `${proj.greeting} ${proj.subject}!!!`,
    });
    assert.equal(proj.message, "Hello World!!!");
});


test("prop: expand arrays", (t) =>
{
    let proj = new Project();
    proj.set({
        greeting: "Hello",
        subject: "World",
        message: [ "$(greeting)", "$(subject)" ],
    });
    assert.deepEqual(proj.message, [ "Hello", "World" ]);
})

test("prop: expand arrays from callbacks", (t) =>
{
    let proj = new Project();
    proj.set({
        greeting: "Hello",
        subject: "World",
        message: () => [ "$(greeting)", [ "$(subject)", "!!!" ] ],
    });
    assert.deepEqual(proj.message, [ "Hello", [ "World", "!!!" ] ]);
})


test("prop: props on other objects", (t) =>
{
    let proj = new Project();
    proj.set({
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


test("prop: invalid property set", (t) =>
{
    let proj = new Project();
    assert.throws(() => proj.set("ruleTarget", "xx"), /override/);
})


test("prop: extend value", (t) =>
{
    let proj = new Project();
    proj.set("apples", "red");

    assert.equal(proj.apples, "red");

    proj.set("apples", (p) => `${p} and green`);
    assert.equal(proj.apples, "red and green");
})

test("prop: dynamic property extension", (t) =>
{
    let proj = new Project();

    // Set a property with a getter
    let color = "red"
    proj.set("apples", () => color);
    assert.equal(proj.apples, "red");

    // Extend the property using the old value `p`
    proj.set("apples", (p) => `${p} and green`);
    assert.equal(proj.apples, "red and green");

    // Extended property should pick up changes to the 
    // original property value.
    color = "yellow";
    assert.equal(proj.apples, "yellow and green");
})


test("prop: dynamic property extension 2", (t) =>
{
    let proj = new Project();

    // Set a property with a getter
    proj.set("apples", "$(color)");
    proj.set("color", "red");
    assert.equal(proj.apples, "red");

    // Extend the property using the old value
    proj.set("apples", (p) => `${p} and green`);
    assert.equal(proj.apples, "red and green");

    // Extended property should pick up changes to the 
    // original property value.
    proj.set("color", "yellow");
    assert.equal(proj.apples, "yellow and green");
})




test("prop: dynamic property extension", (t) =>
{
    let proj = new Project();

    // Define "libs" variable
    let stdlibs = ["a", "b"];
    proj.set("libs", () => stdlibs);
    assert.deepEqual(proj.libs, ["a", "b"]);

    // Add some libraries
    proj.set("libs", (p) => [...p, "c", "d" ]);
    assert.deepEqual(proj.libs, ["a", "b", "c", "d"]);

    // Change the standard libraries
    stdlibs.push("x", "y")
    assert.deepEqual(proj.libs, ["a", "b", "x", "y", "c", "d"]);

    // Remove some libraries
    proj.set("libs", (p) => p.filter(x => !x.match(/y|c/)));
    assert.deepEqual(proj.libs, ["a", "b", "x", "d"]);
})

