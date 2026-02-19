const { getBearerToken, getUserFromToken, createUserScopedClient } = require("../lib/supabase");

async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  const user = await getUserFromToken(token);

  if (!user) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  req.auth = {
    token,
    user,
    scopedClient: createUserScopedClient(token)
  };

  return next();
}

module.exports = { requireAuth };
