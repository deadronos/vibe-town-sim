const paths: Record<string, string> = {
  brand: "M2 18 8 15v-5l5-4 5 4v5l4 2-9 5z M8 10l5 3 5-3 M13 13v9 M3 8l4-5 4 4 M6 5v8",
  wallet: "M3 7h17v13H3z M4 7V5l13-3v5 M15 12h6v4h-6z",
  people:
    "M3 20v-3a5 5 0 0 1 10 0v3 M13 12a5 5 0 0 1 7 5v3 M11 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M15 4a3 3 0 0 1 0 6",
  smile: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M7 14q5 6 10 0 M8 9h.1 M16 9h.1",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  pin: "M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0 M14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.01",
  pointer: "m4 3 15 10-7 1-3 7z",
  layers: "m2 9 10-6 10 6-10 6z M3 13l9 5 9-5 M3 17l9 5 9-5",
  plus: "M12 4v16 M4 12h16",
  minus: "M4 12h16",
  rotate: "M4 8a9 9 0 1 1 0 9 M4 3v6h6",
  orbit: "M21 11a9 5 0 1 1-3-3 M20 4l1 7-6-2 M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  fit: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
  hammer: "m4 21 9-11 3 3-10 9z M9 5l4-3 8 7-3 4-5-5-2 1z",
  close: "M5 5l14 14 M19 5 5 19",
  pause: "M8 5v14 M15 5v14",
  play: "m7 4 12 8-12 8z",
};
export function icon(name: string) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
}
