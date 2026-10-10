// Offline account names go through Minecraft's own name filter: the Minecraft Services name check
// (the one used when you change your Java name) answers NOT_ALLOWED for inappropriate names. It
// needs a signed-in Microsoft account; without one (or offline) a built-in word list is used.

const CHECK_URL = name => `https://api.minecraftservices.com/minecraft/profile/name/${encodeURIComponent(name)}/available`;

// Fallback lists, matched after undoing common letter swaps (0 -> o, 1 -> i, 3 -> e, ...).
// STRONG words are blocked anywhere in a name; SHORT ones only as a whole part of it (split at
// underscores, digits and capitals), so names like "Cucumber" or "Analyst" still work.
const STRONG = [
  'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'vagina', 'whore', 'slut', 'porn', 'nigger',
  'nigga', 'faggot', 'retard', 'tranny', 'wetback', 'asshole', 'molest', 'pedophile', 'killyourself', 'hitler',
  'swastika', 'jizz',
];
const SHORT = [
  'fuk', 'fck', 'rapist', 'dick', 'cock', 'penis', 'boob', 'boobs', 'tits', 'sex', 'rape', 'nazi', 'niger', 'fag', 'kike',
  'spic', 'chink', 'dyke', 'cum', 'anal', 'anus', 'wank', 'twat', 'pedo', 'kys', 'isis', 'kkk', 'heil',
];
const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '$': 's', '@': 'a' };
const squash = s => s.replace(/(.)\1+/g, '$1');
const normalize = text => squash(text.toLowerCase().replace(/[013456789$@]/g, c => SWAPS[c] || c));

function blockedLocally(name, strongOnly = false) {
  const whole = normalize(name.replace(/_/g, ''));
  if (STRONG.some(w => whole.includes(squash(w)))) return true;
  if (strongOnly) return false;
  // Parts: "BigDick" -> big, dick; "sex_god" -> sex, god; "xXKillerXx_99" -> x, xkiller, xx.
  const parts = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[_\s]+|(?<=[A-Za-z])(?=\d{2,})/).map(normalize).filter(Boolean);
  return SHORT.some(w => whole === squash(w) || parts.includes(squash(w)));
}

/**
 * Resolves when the name is fine, throws a friendly error when it isn't.
 * @param {string} name
 * @param {string|null} token a Minecraft access token (any signed-in Microsoft account), or null
 */
async function check(name, token) {
  if (token) {
    try {
      const res = await fetch(CHECK_URL(name), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const { status } = await res.json();
        if (status === 'NOT_ALLOWED') throw new NameError();
        if (status === 'AVAILABLE' || status === 'DUPLICATE') {
          // Minecraft's filter is fine with it; the local list still catches obvious spellings.
          if (blockedLocally(name, true)) throw new NameError();
          return;
        }
      }
    } catch (err) {
      if (err instanceof NameError) throw err;
      // Offline or the service failed: fall through to the local list.
    }
  }
  if (blockedLocally(name)) throw new NameError();
}

class NameError extends Error {
  constructor() {
    super("That name isn't allowed. Please pick another one.");
  }
}

module.exports = { check, blockedLocally };
