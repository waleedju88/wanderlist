# 🗺️ Wanderlist

A collaborative travel list web app — plan trips, save places, share with friends, and navigate with Google Maps.

## ✨ Features

- 📍 Create and manage travel lists
- 🗺️ Open all places in Google Maps with one tap
- 👥 Share lists with friends and collaborate in real time
- 📝 Add personal notes to any place
- ✅ Mark places as visited
- 🔒 Private, shared, and public list privacy settings
- 🔐 Email + Google OAuth login
- 👑 Admin dashboard to manage users
- 📱 Fully responsive — works great on iPad, iPhone, and desktop

## 🚀 Live Demo

> Add your Netlify URL here after deploying

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Auth | Supabase Auth (Email + Google OAuth) |
| Database | Supabase (PostgreSQL) |
| Hosting | Netlify (free tier) |

## 📁 Project Structure

```
wanderlist/
├── index.html        # Main HTML file
├── style.css         # All styles
├── app.js            # All JavaScript + Supabase logic
├── assets/
│   ├── favicon.svg   # Browser favicon
│   └── icon.svg      # Apple home screen icon
├── .gitignore        # Git ignore rules
└── README.md         # This file
```

## ⚙️ Setup

### 1. Supabase Database

1. Go to [supabase.com](https://supabase.com) and create a free project
2. Open **SQL Editor** and run the SQL in the comment block at the top of `app.js`
3. Go to **Settings → API** and copy your **Project URL** and **anon key**
4. Paste them into `app.js`:

```js
var SUPABASE_URL  = 'https://your-project.supabase.co';
var SUPABASE_ANON = 'your-anon-key';
```

### 2. Google OAuth (optional)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create OAuth credentials for a **Web application**
3. Add your site URL to authorised origins
4. Add `https://your-project.supabase.co/auth/v1/callback` to redirect URIs
5. Paste Client ID and Secret into Supabase → **Authentication → Providers → Google**

### 3. Deploy to Netlify

1. Go to [netlify.com/drop](https://app.netlify.com/drop)
2. Drag and drop this entire `wanderlist` folder
3. Copy your live URL (e.g. `https://your-name.netlify.app`)
4. Add it to Supabase → **Authentication → URL Configuration → Site URL**

### 4. Make yourself Admin

After signing up on the live site, run this in Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'YOUR_EMAIL@example.com'
);
```

## 🗄️ Database Schema

```
profiles      → user name, avatar, role (user/admin)
lists         → travel lists with title, color, privacy
list_members  → collaborators on shared lists
places        → places inside each list
notes         → personal notes on each place
```

## 📱 Add to iPad Home Screen

1. Open your Netlify URL in **Safari**
2. Tap the **Share** button (box with arrow)
3. Tap **Add to Home Screen**
4. Tap **Add** — it now works like a native app!

## 📄 License

MIT — free to use, modify, and share.
