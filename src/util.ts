export function flatten(arr: number[] | number[][]) {
  return arr
    .toString()
    .split(',')
    .map(item => +item);
}

export function int(num: number) {
  return num > 0 ? Math.floor(num) : Math.ceil(num);
}

export function clip(data: number, min: number, max: number) {
  return data < min ? min : data > max ? max : data;
}

export function b64Encode(str: string) {
  const te = new TextEncoder();
  const buffer = te.encode(str);
  return btoa(String.fromCharCode(...buffer));
}

export function b64Decode(data: string) {
  const bin = atob(data);
  const arr: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    arr.push(bin.charCodeAt(i));
  }
  const td = new TextDecoder();
  return td.decode(Uint8Array.from(arr));
}
