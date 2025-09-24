import { quotedJoin } from "./utils.js";

export class Project2
{
    // Evaluate a value by invoking callbacks, and expanding strings
    // val - the value to evaluate
    // [callbackThis] - the value of "this" for callbacks (this if unspecified)
    eval(val, callbackThis)
    {
        // Recursively evaluate arrays
        if (Array.isArray(val))
            return val.map(x => this.eval(x, callbackThis));

        switch (typeof(val))
        {
            case "function":
                if (callbackThis === undefined)
                    return this.eval(val.call(this));
                else
                    return this.eval(val.call(callbackThis, this), callbackThis);

            case "string":
                return val.replace(/\$\(([^)]+)\)/g, (m, varname) => {
                    let v = this[varname];
                    if (v === undefined || v === null)
                        return "";
                    if (Array.isArray(v))
                        return quotedJoin(v);
                    else
                        return v;
                });

            case "object":
                let result = {};
                for (let [key, val] of Object.entries(val))
                {
                    this[key] = this.eval(val[key], callbackThis);
                }
                return result;
        }

        return val;
    }

    // Define a property on 'object', named 'key' with
    // value 'val' that will be this.eval'd each acces
    createProperty(object, key, val)
    {
        let self = this;

        // Is it a type that needs evaluating?
        if (Array.isArray(val) || 
            (typeof(val) === 'string' && val.indexOf("$(") >= 0)  ||
            typeof(val) === 'function' ||
            typeof(val) === 'object')
        {
            Object.defineProperty(object, key, {
                get: function() { return self.eval(val, object) },
                enumerable: true,
                configurable: true
            });
        }
        else if (val === undefined)
        {
            // Delete key?
            delete object[key];
        }
        else
        {
            // Set simpel value
            object[key] = val;
        }
    }

    // Define properties on this project
    define(defs)
    {
        if (arguments.length == 2)
        {
            // define(key, val)
            let [key, val] = arguments;
            this.createProperty(this, key, val);
        }
        else
        {
            // define({key: val, ...})
            for (let [key, val] of Object.entries(defs))
            {
                this.createProperty(this, key, val);
            }
        }
    }   

    // Define a properties on this project, but only if
    // not already defined.
    default(defs)
    {
        if (arguments.length == 2)
        {
            // default(key, val)
            let [key, val] = arguments;
            if (this[key] === undefined)
                this.createProperty(this, key, val);
            return;
        }

        // default({key: val, ...})
        for (let [key, val] of Object.entries(defs))
        {
            if (this[key] === undefined)
                this.createProperty(this, key, val);
        }
    }
}