// icons.js
// The pin type library. Add a new entry here to add a new marker type
// throughout the whole app (placement menu, filters, map icon, notes list).
// `toggleable` types get an "opened / unopened" style checkbox in the pin
// editor (state stored as pin.state = "opened" | "unopened").

export const PIN_TYPES = [
  { id: "save-point", label: "Save Point", glyph: "💾", toggleable: false },
  { id: "chest", label: "Chest", glyph: "💰", toggleable: true, stateLabel: "Opened" },
  { id: "shop", label: "Shop", glyph: "🏪", toggleable: true, stateLabel: "Bought" },
  { id: "sidearm", label: "Sidearm", glyph: "🗡️", toggleable: false },
  { id: "kear", label: "Kear", glyph: "🗝️", toggleable: true, stateLabel: "Found" },
  { id: "lock", label: "Lock", glyph: "🔒", toggleable: true, stateLabel: "Opened" },
  { id: "note", label: "Note", glyph: "📝", toggleable: true, stateLabel: "Completed" },
];

export function getPinType(id) {
  return PIN_TYPES.find((t) => t.id === id) || PIN_TYPES[PIN_TYPES.length - 1];
}
