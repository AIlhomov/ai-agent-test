// Bug: capitalize() should uppercase the first letter and leave the rest unchanged,
// but currently lowercases the entire string.
export function capitalize(str) {
    return str.toLowerCase();
}

// Bug: repeat() should return str repeated exactly n times,
// but currently returns n+1 repetitions.
export function repeat(str, n) {
    return str.repeat(n + 1);
}
