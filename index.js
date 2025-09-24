import { Project } from "./Project.js";

let proj = new Project();
await proj.load("mk.js");
await proj.buildTarget("default");