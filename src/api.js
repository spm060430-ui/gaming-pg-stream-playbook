// Optional integration with the public PokémonTCG API (https://pokemontcg.io).
// Used to autofill real card images and a real-world base price when searching.
// The app works fully without it — every failure falls back to manual entry.

const BASE = 'https://api.pokemontcg.io/v2/cards'

// Pull a sensible market price out of the tcgplayer / cardmarket price blocks.
function extractPrice(card) {
  const tp = card?.tcgplayer?.prices
  if (tp) {
    for (const variant of ['holofoil', 'reverseHolofoil', 'normal', '1stEditionHolofoil', 'unlimited']) {
      const p = tp[variant]?.market ?? tp[variant]?.mid
      if (p) return p
    }
  }
  const cm = card?.cardmarket?.prices
  if (cm?.trendPrice) return cm.trendPrice
  if (cm?.averageSellPrice) return cm.averageSellPrice
  return null
}

export async function searchCards(query) {
  const q = query.trim()
  if (!q) return []
  const url = `${BASE}?q=${encodeURIComponent(`name:"${q}*"`)}&pageSize=12&orderBy=-set.releaseDate`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`API responded ${res.status}`)
  const json = await res.json()
  return (json.data || []).map((c) => ({
    id: c.id,
    name: c.name,
    set: c.set?.name || '',
    number: c.number || '',
    rarity: c.rarity || '',
    image: c.images?.small || c.images?.large || '',
    marketPrice: extractPrice(c),
  }))
}
