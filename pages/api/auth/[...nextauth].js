import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import GoogleProvider from "next-auth/providers/google";

export default NextAuth({
  providers: [
    AzureADProvider({
      clientId:     process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      tenantId:     "common",
      authorization: {
        params: {
          scope: "openid profile email offline_access Files.Read Files.ReadWrite",
        },
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID ? [
      GoogleProvider({
        clientId:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authorization: {
          params: {
            scope: "openid profile email https://www.googleapis.com/auth/drive.readonly",
          },
        },
      }),
    ] : []),
  ],

  callbacks: {
    async jwt({ token, account }) {
      // Beim ersten Login: Access Token + Provider speichern
      if (account) {
        token.accessToken    = account.access_token;
        token.refreshToken   = account.refresh_token;
        token.provider       = account.provider;
        token.expiresAt      = account.expires_at;   // Unix-Timestamp in Sekunden
      }

      // Token noch gültig?
      const nowSec = Math.floor(Date.now() / 1000);
      if (token.expiresAt && nowSec < token.expiresAt - 60) {
        return token;
      }

      // Token abgelaufen → Refresh versuchen (nur Azure AD / OneDrive)
      if (token.provider === "azure-ad" && token.refreshToken) {
        try {
          const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id:     process.env.AZURE_CLIENT_ID,
              client_secret: process.env.AZURE_CLIENT_SECRET,
              grant_type:    "refresh_token",
              refresh_token: token.refreshToken,
              scope:         "openid profile email offline_access Files.Read Files.ReadWrite",
            }),
          });
          const refreshed = await res.json();
          if (refreshed.access_token) {
            token.accessToken  = refreshed.access_token;
            token.expiresAt    = Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600);
            if (refreshed.refresh_token) token.refreshToken = refreshed.refresh_token;
            return token;
          }
        } catch (e) {
          console.error("Token refresh failed:", e);
        }
        // Refresh fehlgeschlagen → User muss neu einloggen
        return { ...token, error: "RefreshAccessTokenError" };
      }

      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.provider    = token.provider;
      session.error       = token.error;
      return session;
    },
  },

  pages: {},
  secret: process.env.NEXTAUTH_SECRET,
});
