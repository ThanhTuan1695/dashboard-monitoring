// Status colors straight from the dataviz reference palette (references/palette.md)
// — these are fixed status roles, not themed hues, and stay the single source of
// truth for status color everywhere (badges, tiles, the history timeline chart).
export const statusColors = {
  up: '#0ca30c', // status: good
  down: '#d03b3b', // status: critical
  unknown: '#898781', // muted ink — "no data yet", not a status color
};
