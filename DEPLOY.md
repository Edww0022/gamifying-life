# Sidequest cloud setup

1. Create a free project at https://supabase.com/dashboard.
2. Open **SQL Editor**, paste `supabase-setup.sql` into a new query, and run it.
3. Open **Project Settings → API**. Copy the Project URL and anon/public key into `config.js`. Never use the `service_role` key in a website.
4. In **Authentication → URL Configuration**, set Site URL to your deployed Netlify URL.
5. Upload this entire folder at https://app.netlify.com/drop.
6. Open the deployed site, select **Local only**, create an account, and use that login on your phone.

Row Level Security ensures signed-in users can only access their own saved game.
