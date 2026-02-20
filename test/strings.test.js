import test from "node:test";
import assert from "node:assert/strict";
import { capitalize, repeat } from "./strings.js";

test("capitalize: uppercases first letter, leaves rest unchanged", () => {
    assert.equal(capitalize("hello"), "Hello");
});

test("capitalize: single character", () => {
    assert.equal(capitalize("a"), "A");
});

test("capitalize: already capitalized string", () => {
    assert.equal(capitalize("Hello"), "Hello");
});

test("capitalize: preserves mixed case after first letter", () => {
    assert.equal(capitalize("hELLO"), "HELLO");
});

test("capitalize: all uppercase string", () => {
    assert.equal(capitalize("WORLD"), "WORLD");
});

test("capitalize: empty string", () => {
    assert.equal(capitalize(""), "");
});

test("capitalize: does not lowercase entire string", () => {
    const result = capitalize("hELLO");
    assert.notEqual(result, "hello");
});

test("repeat: repeats string exactly n times", () => {
    assert.equal(repeat("ab", 3), "ababab");
});

test("repeat: repeat 1 time", () => {
    assert.equal(repeat("hello", 1), "hello");
});

test("repeat: repeat 0 times returns empty string", () => {
    assert.equal(repeat("hello", 0), "");
});

test("repeat: repeat 2 times", () => {
    assert.equal(repeat("x", 2), "xx");
});

test("repeat: does not return n+1 repetitions", () => {
    const result = repeat("ab", 3);
    assert.notEqual(result, "abababab");
});

test("repeat: repeat single character multiple times", () => {
    assert.equal(repeat("a", 5), "aaaaa");
});
