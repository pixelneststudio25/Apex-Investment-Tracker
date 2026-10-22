// Public configuration. The anon key is designed to be public: Row Level
// Security protects the data. NEVER put the service_role key in this repo.
// One Supabase project is used for everything (decision: single project).
export const supabaseConfig = {
  url: 'https://ialsuhajbubejqavhjnw.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhbHN1aGFqYnViZWpxYXZoam53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NzMzNzksImV4cCI6MjEwODI0OTM3OX0.v2K_NfPBXvwlquNxvJAPsIE96r1cDR21mijutjuHIhM',
};
