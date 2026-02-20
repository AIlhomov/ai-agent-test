export function capitalize(str) {
    if (str.length === 0) return str;
    return str[0].toUpperCase() + str.slice(1);
}

export function repeat(str, n) {
    return str.repeat(n);
}
