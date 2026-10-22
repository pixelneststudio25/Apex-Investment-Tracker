// Public configuration. The anon key is designed to be public: Row Level
// Security protects the data. NEVER put the service_role key in this repo.
const DEV = { url: 'https://YOUR-DEV-REF.supabase.co', anonKey: 'YOUR-DEV-ANON-KEY' };
const PROD = { url: 'https://YOUR-PROD-REF.supabase.co', anonKey: 'YOUR-PROD-ANON-KEY' };

// Replace with your real production domain once it exists.
const PROD_HOSTS = ['apex.example.com'];

export const supabaseConfig = PROD_HOSTS.includes(location.hostname) ? PROD : DEV;
