// Microsoft account -> Xbox Live -> XSTS -> Minecraft services.
// Uses the live.com desktop OAuth flow, which works without a Mojang-approved Azure app.
// To use your own approved Azure app instead, set CLIENT_ID / redirect accordingly.
const CLIENT_ID = '00000000402b5328';
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';

const AUTHORIZE_URL = 'https://login.live.com/oauth20_authorize.srf?' + new URLSearchParams({
  client_id: CLIENT_ID,
  response_type: 'code',
  scope: SCOPE,
  redirect_uri: REDIRECT_URI,
  prompt: 'select_account',
});

class AuthError extends Error {}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
}

async function msToken(params) {
  const res = await fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPE, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new AuthError(data.error_description || 'Microsoft sign-in failed');
  return data; // { access_token, refresh_token, expires_in }
}

const XSTS_ERRORS = {
  2148916233: 'This Microsoft account has no Xbox profile. Sign in once at minecraft.net to create one.',
  2148916235: 'Xbox Live is not available in your country.',
  2148916236: 'This account needs adult verification on xbox.com (South Korea).',
  2148916237: 'This account needs adult verification on xbox.com (South Korea).',
  2148916238: 'This is a child account. An adult must add it to a Microsoft family first.',
};

async function minecraftFromMs(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (!xbl.ok) throw new AuthError(`Xbox Live sign-in failed (${xbl.status})`);

  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (!xsts.ok) throw new AuthError(XSTS_ERRORS[xsts.data.XErr] || `Xbox authorisation failed (${xsts.status})`);
  const { uhs, xid } = xsts.data.DisplayClaims.xui[0];

  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}`,
  });
  if (!mc.ok) throw new AuthError(`Minecraft sign-in failed (${mc.status})`);

  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.data.access_token}` },
  });
  if (res.status === 404) throw new AuthError("This Microsoft account doesn't own Minecraft: Java Edition.");
  if (!res.ok) throw new AuthError(`Could not load Minecraft profile (${res.status})`);
  const profile = await res.json();
  const skin = profile.skins?.find(s => s.state === 'ACTIVE') || profile.skins?.[0];

  return {
    uuid: profile.id,
    name: profile.name,
    skinUrl: skin?.url || null,
    xuid: xid || '',
    accessToken: mc.data.access_token,
    expiresAt: Date.now() + mc.data.expires_in * 1000,
  };
}

// Exchange the ?code= from the login window for a full account.
async function loginWithCode(code) {
  const ms = await msToken({ grant_type: 'authorization_code', code });
  return { type: 'microsoft', refreshToken: ms.refresh_token, ...(await minecraftFromMs(ms.access_token)) };
}

// Returns the account with a fresh Minecraft token (refreshing through Microsoft if needed).
async function ensureFresh(account) {
  if (account.type !== 'microsoft') return account;
  if (account.expiresAt - Date.now() > 5 * 60 * 1000) return account;
  const ms = await msToken({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
  return { ...account, refreshToken: ms.refresh_token || account.refreshToken, ...(await minecraftFromMs(ms.access_token)) };
}

module.exports = { AUTHORIZE_URL, REDIRECT_URI, AuthError, loginWithCode, ensureFresh };
