# FarmPro Management

A professional, mobile-responsive farm management starter app using React + Vite and Supabase.

## Current backend
Supabase project reference: `ymffswhyvbrbizlbtkgr`
Project URL: `https://ymffswhyvbrbizlbtkgr.supabase.co`

The database currently contains tables for farms, livestock, poultry batches, health records, breeding records, feed inventory/logs, production, customers, suppliers, sales and sale items, purchases, expenses, inventory items/movements, and farm tasks. RLS is enabled on these tables.

## Dashboard
The dashboard reads live records through the authenticated Supabase client and scopes its queries to the signed-in owner and selected farm. Use the farm selector in the sidebar to switch farms, and the reporting-period control to update financial and production views. Financial profit is an operating estimate based only on recorded sales less recorded expenses; purchases are not included as expenses.

## Run locally on Windows
1. Install Node.js LTS if it is not installed.
2. Extract this ZIP.
3. Open the extracted `farmpro-management` folder in VS Code.
4. Copy `.env.example` to a new file named `.env`.
5. In `.env`, set `VITE_SUPABASE_PUBLISHABLE_KEY` to your Supabase **publishable** key. Do not use a service-role/secret key in this app.
6. Open VS Code Terminal and run:
   ```bash
   npm install
   npm run dev
   ```
7. Open the local address Vite prints (normally `http://localhost:5173`).

## Important first-run note
Create your first account using the Sign up form. Email confirmation may be required depending on your Supabase Auth settings.

After signing in, use **Manage Farms** beneath the farm selector to create and edit your farm profiles. The selected farm is remembered in this browser for that signed-in account. Farm records are loaded and saved through the authenticated Supabase client and remain subject to the database's row-level security policies. Farm deletion is not available.

## Security
- Use only the publishable key in frontend code.
- Never put a Supabase service-role or secret key in `.env` for this browser app.
- Database policies restrict access to the authenticated owner.
