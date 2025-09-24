import { test } from "node:test";
import { strict as assert } from "node:assert";

import { Project2 } from "../Project2.js";

test("prop: simple", (t) =>
{
    let proj = new Project2();
    proj.define({
        greeting: "Hello World",
    });
    assert.equal(proj.greeting, "Hello World");
});


test("prop: callback", (t) =>
{
    let proj = new Project2();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: () => `${proj.greeting} ${proj.subject}`
    });
    assert.equal(proj.message, "Hello World");
});

test("prop: expand", (t) =>
{
    let proj = new Project2();
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
    let proj = new Project2();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: function() { return `${this.greeting} ${this.subject}` }
    });
    assert.equal(proj.message, "Hello World");
});

test("prop: redefine property", (t) =>
{
    let proj = new Project2();
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
    let proj = new Project2();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: [ "$(greeting)", "$(subject)" ],
    });
    assert.deepEqual(proj.message, [ "Hello", "World" ]);
})

test("prop: expand arrays from callbacks", (t) =>
{
    let proj = new Project2();
    proj.define({
        greeting: "Hello",
        subject: "World",
        message: () => [ "$(greeting)", [ "$(subject)", "!!!" ] ],
    });
    assert.deepEqual(proj.message, [ "Hello", [ "World", "!!!" ] ]);
})


test("prop: props on other objects", (t) =>
{
    let proj = new Project2();
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
