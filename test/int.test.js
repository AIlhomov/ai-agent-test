import test from "node:test";
import assert from "node:assert/strict";
import { add } from "./int.js";

test("add returns a number, not a string", () => {
    const result = add(1, 2);
    assert.equal(typeof result, "number");
});

test("add(1, 2) equals 3", () => {
    assert.equal(add(1, 2), 3);
});

test("add(0, 0) equals 0", () => {
    assert.equal(add(0, 0), 0);
});

test("add(-1, 1) equals 0", () => {
    assert.equal(add(-1, 1), 0);
});

test("add(100, 200) equals 300", () => {
    assert.equal(add(100, 200), 300);
});

test("add(-5, -3) equals -8", () => {
    assert.equal(add(-5, -3), -8);
});

test("add result is not a concatenated string", () => {
    assert.notEqual(add(1, 2), "12");
});
