// icons.js
// The pin type library. Add a new entry here to add a new marker type
// throughout the whole app (placement menu, filters, map icon, notes list).
// `toggleable` types get an "opened / unopened" style checkbox in the pin
// editor (state stored as pin.state = "opened" | "unopened").

export const PIN_TYPES = [
  { id: "chest", label: "Chest", glyph: "🧰", toggleable: true, stateLabel: "Opened" },
  { id: "save-point", label: "Save Point", glyph: "🕯️", toggleable: false },
  { id: "sidearm", label: "Sidearm", glyph: "🗡️", toggleable: true, stateLabel: "Collected" },
  { id: "item", label: "Item", glyph: "💎", toggleable: true, stateLabel: "Collected" },
  { id: "enemy", label: "Notable Foe", glyph: "💀", toggleable: false },
  { id: "note", label: "Note", glyph: "📝", toggleable: false },
];

export function getPinType(id) {
  return PIN_TYPES.find((t) => t.id === id) || PIN_TYPES[PIN_TYPES.length - 1];
}
