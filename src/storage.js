// Tiny localStorage-backed persistence for the collection.
const KEY = 'pokestock.collection.v1'

export function loadCollection() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCollection(cards) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards))
  } catch {
    // Storage full or unavailable — fail quietly, the app still works in-memory.
  }
}
