// Wanderlist - app.js
// Wanderlist - app.js
/* ═══════════════════════════════════════════════════════
   SUPABASE CONFIG
   -------------------------------------------------------
   1. Go to https://supabase.com and create a free project
   2. Go to Settings > API and copy:
      - Project URL  →  replace SUPABASE_URL below
      - anon/public key  →  replace SUPABASE_ANON_KEY below
   3. Run this SQL in Supabase SQL Editor to create tables:

   -- Profiles table (extends auth.users)
   create table public.profiles (
     id uuid references auth.users(id) primary key,
     name text, avatar_url text, role text default 'user',
     created_at timestamptz default now()
   );
   alter table public.profiles enable row level security;
   create policy "Users can view all profiles" on public.profiles for select using (true);
   create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

   -- Lists table
   create table public.lists (
     id uuid primary key default gen_random_uuid(),
     owner_id uuid references auth.users(id) on delete cascade,
     title text not null, description text, color text default '#C4622D',
     privacy text default 'private', created_at timestamptz default now()
   );
   alter table public.lists enable row level security;
   create policy "Owner full access" on public.lists for all using (auth.uid() = owner_id);
   create policy "Read shared/public" on public.lists for select using (privacy in ('shared','public'));

   -- Places table
   create table public.places (
     id uuid primary key default gen_random_uuid(),
     list_id uuid references public.lists(id) on delete cascade,
     added_by uuid references auth.users(id),
     name text not null, address text, category text,
     color1 text default '#8B7D6B', color2 text default '#B5A898',
     emoji text default 'pin', visited boolean default false,
     lat numeric, lng numeric,
     place_id text,
     maps_url text,
     created_at timestamptz default now()
   );
   alter table public.places enable row level security;
   create policy "List members access places" on public.places for all
     using (list_id in (select id from public.lists where owner_id = auth.uid() or privacy in ('shared','public')));

   -- Notes table
   create table public.notes (
     id uuid primary key default gen_random_uuid(),
     place_id uuid references public.places(id) on delete cascade,
     author_id uuid references auth.users(id),
     author_name text, content text not null,
     created_at timestamptz default now()
   );
   alter table public.notes enable row level security;
   create policy "Notes readable by list members" on public.notes for select using (true);
   create policy "Authenticated users can add notes" on public.notes for insert with check (auth.uid() = author_id);

   -- List members table
   create table public.list_members (
     list_id uuid references public.lists(id) on delete cascade,
     user_id uuid references auth.users(id) on delete cascade,
     role text default 'viewer',
     primary key (list_id, user_id)
   );
   alter table public.list_members enable row level security;
   create policy "Members can view" on public.list_members for select using (true);
   create policy "Owner can manage" on public.list_members for all
     using (list_id in (select id from public.lists where owner_id = auth.uid()));

   -- Auto-create profile on signup
   create or replace function public.handle_new_user()
   returns trigger as $$ begin
     insert into public.profiles (id, name, avatar_url)
     values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'avatar_url');
     return new;
   end; $$ language plpgsql security definer;
   create trigger on_auth_user_created after insert on auth.users
     for each row execute procedure public.handle_new_user();

   4. In Supabase Auth settings, enable Google OAuth and add your
      Google Client ID and Secret (from console.cloud.google.com)
   5. Add your site URL to Supabase Auth > URL Configuration > Site URL
═══════════════════════════════════════════════════════ */

var SUPABASE_URL  = 'https://doyforyhqdcpnuxcrxvr.supabase.co';
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRveWZvcnlocWRjcG51eGNyeHZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjE5MzcsImV4cCI6MjA4OTQzNzkzN30.H4Q8gzdIr0YS47kNUPQUijZL1GoEVnA-CJr3PmKiF8U';

/* ─── Deployed to: https://waleedju88.github.io/wanderlist ───
   Google Maps / Places API Key ───────────────────────────
   Get a free key at: https://console.cloud.google.com
   → APIs & Services → Credentials → Create API Key
   Enable these two APIs in your project:
     1. Maps JavaScript API
     2. Places API
   Then restrict the key to your Netlify / GitHub Pages domain.
──────────────────────────────────────────────────────────── */
var GOOGLE_MAPS_KEY = 'AIzaSyBVdBl6PrgOFLV_0s6VDczdHrS_KUyeNdc';

/* ─── detect configured ─── */
var isConfigured = (
  SUPABASE_URL !== '' &&
  SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
  SUPABASE_URL.indexOf('supabase.co') !== -1
);

/* ─── init supabase safely ─── */
var sb = null;
try {
  if(isConfigured && typeof supabase !== 'undefined'){
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
} catch(e){
  console.warn('Supabase init failed:', e);
  isConfigured = false;
}

/* ─── app state ─── */
var currentUser   = null;
var selectedPlace = null;  // holds Google Places result
var currentProfile= null;
var currentListId = null;
var currentPlace  = null;
var curPriv       = 'p';
var dkCollapsed   = false;

/* ═══════════════════════════════════════
   DEMO MODE (when Supabase not configured)
═══════════════════════════════════════ */
var DEMO_LISTS = [
  {id:'d1',title:'Japan Trip 2025',color:'#C4622D',privacy:'shared',owner_id:'demo'},
  {id:'d2',title:'Secret Spots',color:'#8B7D6B',privacy:'private',owner_id:'demo'},
];
var DEMO_PLACES = {
  d1:[
    {id:'p1',list_id:'d1',name:'Fushimi Inari Taisha',address:'Fushimi Ward, Kyoto',category:'Culture',color1:'#C4622D',color2:'#E8895A',emoji:'shrine',visited:true},
    {id:'p2',list_id:'d1',name:'Tsukiji Outer Market',address:'Chuo, Tokyo',category:'Food',color1:'#2D6B8C',color2:'#5A9BBF',emoji:'sushi',visited:false},
    {id:'p3',list_id:'d1',name:'Arashiyama Bamboo Grove',address:'Ukyo, Kyoto',category:'Nature',color1:'#4A7C59',color2:'#7EAF8E',emoji:'bamboo',visited:false},
  ],
  d2:[]
};
var DEMO_NOTES = {p1:['Alex: Go at 5am — bring a headlamp!'],p2:['Tom: Best tuna at stall 7'],p3:[]};

var EMOJIS = {shrine:'&#9961;&#65039;',sushi:'&#127843;',bamboo:'&#127179;',crossing:'&#128678;',temple:'&#127983;',food:'&#129406;',pin:'&#128205;'};
var DEMO_USER = {id:'demo',email:'demo@wanderlist.app',name:'Demo User',role:'admin',avatar:null};

/* ═══════════════════════════════════════
   AUTH
═══════════════════════════════════════ */
function showAuthTab(tab){
  document.getElementById('tab-login').classList.toggle('on', tab==='login');
  document.getElementById('tab-signup').classList.toggle('on', tab==='signup');
  document.getElementById('form-login').style.display  = tab==='login'  ? 'block' : 'none';
  document.getElementById('form-signup').style.display = tab==='signup' ? 'block' : 'none';
  document.getElementById('auth-err').classList.remove('show');
}

function showAuthErr(msg){
  var el = document.getElementById('auth-err');
  el.textContent = msg; el.classList.add('show');
}

async function signInEmail(){
  var email = document.getElementById('login-email').value.trim();
  var pass  = document.getElementById('login-password').value;
  if(!email||!pass){ showAuthErr('Please enter email and password'); return; }
  if(!isConfigured){ enterDemoMode(); return; }
  var res = await sb.auth.signInWithPassword({email,password:pass});
  if(res.error){ showAuthErr(res.error.message); return; }
  onSignedIn(res.data.user);
}

async function signUpEmail(){
  var name  = document.getElementById('signup-name').value.trim();
  var email = document.getElementById('signup-email').value.trim();
  var pass  = document.getElementById('signup-password').value;
  if(!name||!email||!pass){ showAuthErr('Please fill all fields'); return; }
  if(pass.length < 6){ showAuthErr('Password must be at least 6 characters'); return; }
  if(!isConfigured){ enterDemoMode(); return; }
  var res = await sb.auth.signUp({email, password:pass, options:{data:{full_name:name}}});
  if(res.error){ showAuthErr(res.error.message); return; }
  toast('Check your email to confirm your account!');
}

async function signInGoogle(){
  if(!isConfigured){ enterDemoMode(); return; }
  var res = await sb.auth.signInWithOAuth({provider:'google', options:{redirectTo: 'https://waleedju88.github.io/wanderlist/'}});
  if(res.error) showAuthErr(res.error.message);
}

async function signOut(){
  if(isConfigured) await sb.auth.signOut();
  currentUser = null; currentProfile = null;
  showPage('login');
}

function showForgot(){
  var email = document.getElementById('login-email').value.trim();
  if(!email){ showAuthErr('Enter your email above first'); return; }
  if(!isConfigured){ toast('Reset email sent (demo mode)'); return; }
  sb.auth.resetPasswordForEmail(email, {redirectTo: 'https://waleedju88.github.io/wanderlist/'}).then(function(){
    toast('Password reset email sent!');
  });
}

function enterDemoMode(){
  currentUser    = DEMO_USER;
  currentProfile = DEMO_USER;
  showPage('app');
  initApp();
}

async function onSignedIn(user){
  currentUser = user;
  var {data:profile} = await sb.from('profiles').select('*').eq('id',user.id).single();
  currentProfile = profile || {id:user.id, name:user.email, role:'user'};
  showPage('app');
  initApp();
}

/* ═══════════════════════════════════════
   PAGE ROUTING
═══════════════════════════════════════ */
function showPage(name){
  // Hide all pages
  document.querySelectorAll('.page').forEach(function(p){
    p.classList.remove('active');
  });
  // Also handle the login page default-visible state
  var loginPage = document.getElementById('page-login');
  if(loginPage) loginPage.classList.add('hidden-by-js');

  // Show the requested page
  var target = document.getElementById('page-'+name);
  if(target){
    target.classList.add('active');
    // If showing login, remove the hidden class
    if(name === 'login'){
      target.classList.remove('hidden-by-js');
    }
  }
}

/* ═══════════════════════════════════════
   APP INIT
═══════════════════════════════════════ */
function initApp(){
  // Set user info in sidebar
  var name = (currentProfile && currentProfile.name) || currentUser.email;
  var role = (currentProfile && currentProfile.role) || 'user';
  document.getElementById('sb-name').textContent = name;
  document.getElementById('sb-role').textContent = role === 'admin' ? '&#9733; Admin' : 'User';
  var av = document.getElementById('sb-avatar');
  var avatarUrl = currentProfile && currentProfile.avatar_url;
  if(avatarUrl){
    av.innerHTML = '<img src="' + avatarUrl + '" alt="">';
  } else {
    av.textContent = name[0].toUpperCase();
  }
  loadLists();
}

/* ═══════════════════════════════════════
   LOAD LISTS
═══════════════════════════════════════ */
async function loadLists(){
  var lists;
  if(!isConfigured){
    lists = DEMO_LISTS;
  } else {
    var uid = currentUser.id;
    var {data, error} = await sb.from('lists')
      .select('*')
      .or('owner_id.eq.' + uid + ',privacy.in.(shared,public)')
      .order('created_at');
    if(error){ toast('Error loading lists'); return; }
    lists = data || [];
  }
  buildSidebar(lists);
  if(lists.length > 0) selectList(lists[0]);
  else renderEmpty();
}

function buildSidebar(lists){
  var secMy   = document.getElementById('sec-my');
  var secPriv = document.getElementById('sec-priv');
  secMy.querySelectorAll('.li').forEach(function(e){ e.remove(); });
  secPriv.querySelectorAll('.li').forEach(function(e){ e.remove(); });

  lists.forEach(function(list){
    var isOwn = list.owner_id === (currentUser && currentUser.id);
    var sec = (list.privacy === 'private' && isOwn) ? secPriv : secMy;
    var item = makeSidebarItem(list);
    sec.appendChild(item);
  });
}

function makeSidebarItem(list){
  var item = document.createElement('div');
  item.className = 'li';
  item.setAttribute('data-id', list.id);
  var isPrivate = list.privacy === 'private';
  item.innerHTML =
    '<div class="li-dot" style="background:' + (list.color||'#C4622D') + '"></div>' +
    '<span class="li-name">' + list.title + '</span>' +
    (isPrivate ? '<span class="li-lock">&#128274;</span>' : '<span class="li-count">0</span>') +
    '<button class="li-del" title="Delete list">&#10005;</button>';
  item.addEventListener('click', function(){ selectList(list); });
  item.querySelector('.li-del').addEventListener('click', function(e){
    e.stopPropagation(); askDeleteList(list);
  });
  return item;
}

function selectList(list){
  currentListId = list.id;
  document.getElementById('listtitle').textContent = list.title;
  var badgeEl = document.getElementById('listbadge');
  var bmap = {private:{t:'Private',c:'bp'}, shared:{t:'Shared',c:'bs'}, public:{t:'Public',c:'bpub'}};
  var bm = bmap[list.privacy] || bmap['shared'];
  badgeEl.textContent = bm.t; badgeEl.className = 'badge ' + bm.c;
  document.querySelectorAll('.li').forEach(function(i){ i.classList.remove('active'); });
  var activeItem = document.querySelector('.li[data-id="' + list.id + '"]');
  if(activeItem) activeItem.classList.add('active');
  loadPlaces(list.id);
  if(isMob()) closeMobile();
}

/* ═══════════════════════════════════════
   LOAD + RENDER PLACES
═══════════════════════════════════════ */
async function loadPlaces(listId){
  document.getElementById('main-content').innerHTML = '<div class="spinner"></div>';
  var places, notes = {};
  if(!isConfigured){
    places = DEMO_PLACES[listId] || [];
    notes  = DEMO_NOTES;
  } else {
    var {data:pl} = await sb.from('places').select('*').eq('list_id',listId).order('created_at');
    places = pl || [];
    if(places.length){
      var ids = places.map(function(p){ return p.id; });
      var {data:nl} = await sb.from('notes').select('*').in('place_id',ids).order('created_at');
      (nl||[]).forEach(function(n){
        if(!notes[n.place_id]) notes[n.place_id] = [];
        notes[n.place_id].push(n);
      });
    }
  }
  renderPlaces(places, notes);
}

function renderPlaces(places, notes){
  var cnt = document.getElementById('main-content');
  cnt.innerHTML = '';

  // Map strip
  var ms = document.createElement('div');
  ms.className = 'mapstrip';
  ms.onclick = openMapView;
  ms.innerHTML =
    '<div class="mapbg"><svg viewBox="0 0 900 220" preserveAspectRatio="xMidYMid slice">' +
    '<rect width="900" height="220" fill="#E8E0D0"/>' +
    '<path d="M0,80 Q200,60 400,90 Q600,120 900,80" stroke="#D4C9B0" stroke-width="20" fill="none"/>' +
    '<path d="M0,140 Q150,130 300,150 Q500,170 700,140 L900,150" stroke="#D4C9B0" stroke-width="14" fill="none"/>' +
    '<rect x="80" y="30" width="60" height="40" rx="4" fill="#C8BDAA"/>' +
    '<rect x="320" y="50" width="80" height="55" rx="4" fill="#C8BDAA"/>' +
    '<rect x="650" y="60" width="70" height="50" rx="4" fill="#C8BDAA"/>' +
    '</svg></div>' +
    '<div class="pin" style="left:22%;top:52%">&#128205;</div>' +
    '<div class="pin" style="left:48%;top:38%;animation-delay:.15s">&#128205;</div>' +
    '<div class="pin" style="left:74%;top:58%;animation-delay:.3s">&#128205;</div>' +
    '<div class="mapoverlay">' +
    '<button class="mapbtn">&#128506; Open in Google Maps</button>' +
    '<span class="mcount">' + places.length + ' places</span>' +
    '</div>';
  cnt.appendChild(ms);

  // Stats bar
  var vis = places.filter(function(p){ return p.visited; }).length;
  var sh  = document.createElement('div');
  sh.className = 'sec-hdr';
  sh.innerHTML =
    '<div><div class="sec-ttl">Places to Visit</div><div class="sec-sub">' + places.length + ' places &middot; ' + vis + ' visited</div></div>' +
    '<select class="fsel" style="width:auto;padding:6px 10px;font-size:12px"><option>All categories</option><option>Food</option><option>Culture</option><option>Nature</option><option>Shopping</option></select>';
  cnt.appendChild(sh);

  // Update sidebar count
  var sideItem = document.querySelector('.li[data-id="' + currentListId + '"]');
  if(sideItem){ var cc = sideItem.querySelector('.li-count'); if(cc) cc.textContent = places.length; }

  // Grid
  var grid = document.createElement('div');
  grid.className = 'grid';

  places.forEach(function(p, i){
    var placeNotes = notes[p.id] || [];
    var noteFirst = isConfigured ? (placeNotes[0] && placeNotes[0].author_name + ': ' + placeNotes[0].content) : placeNotes[0];
    var emoji = EMOJIS[p.emoji] || EMOJIS['pin'];
    var noteH = noteFirst ? '<div class="pcard-note">' + noteFirst + '</div>' : '';
    var visH  = p.visited ? '<div class="pcard-vis">Visited</div>' : '';

    var card = document.createElement('div');
    card.className = 'pcard';
    card.style.animationDelay = (i * 0.06) + 's';
    card.innerHTML =
      '<div class="pcard-img" style="background:linear-gradient(135deg,' + p.color1 + ',' + p.color2 + ')">' +
        '<div class="pcard-emoji">' + emoji + '</div>' +
        '<div class="pcard-cat">' + p.category + '</div>' + visH +
      '</div>' +
      '<div class="pcard-body">' +
        '<div class="pcard-name">' + p.name + '</div>' +
        '<div class="pcard-addr">' + (p.address||'') + '</div>' +
        noteH +
        '<div class="pcard-ft"><div class="pcard-contribs"></div>' +
        '<div class="pcard-acts">' +
          '<button class="ibtn nav" title="Navigate">&#129517;</button>' +
          '<button class="ibtn del" title="Remove">&#128465;&#65039;</button>' +
        '</div></div>' +
      '</div>';

    card.querySelector('.ibtn.nav').addEventListener('click', function(e){ e.stopPropagation(); navTo(p.name + ' ' + (p.address||''), p.maps_url); });
    card.querySelector('.ibtn.del').addEventListener('click', function(e){ e.stopPropagation(); askDeletePlace(p); });
    card.addEventListener('click', function(){ openDetail(p, placeNotes); });
    grid.appendChild(card);
  });

  // Add card
  var add = document.createElement('div');
  add.className = 'addcard';
  add.innerHTML = '<div class="addcard-icon">&#43;</div><div class="addcard-txt">Add a place</div>';
  add.onclick = function(){ openM('addplace'); };
  grid.appendChild(add);

  cnt.appendChild(grid);
}

function renderEmpty(){
  document.getElementById('main-content').innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center">' +
    '<div style="font-size:48px;opacity:.4;margin-bottom:16px">&#128205;</div>' +
    '<div style="font-family:\'Playfair Display\',serif;font-size:18px;font-weight:700;margin-bottom:8px">No lists yet</div>' +
    '<div style="font-size:13px;color:var(--muted);margin-bottom:20px">Create your first travel list to get started</div>' +
    '<button class="btn btn-p" onclick="openM(\'newlist\')">&#43; Create List</button></div>';
}

/* ═══════════════════════════════════════
   PLACE DETAIL
═══════════════════════════════════════ */
function openDetail(p, placeNotes){
  currentPlace = p;
  document.getElementById('det-title').textContent = p.name;
  document.getElementById('det-addr').textContent  = p.address || '';
  var img = document.getElementById('det-img');
  img.innerHTML = EMOJIS[p.emoji] || EMOJIS['pin'];
  img.style.background = 'linear-gradient(135deg,' + p.color1 + ',' + p.color2 + ')';
  var nl = document.getElementById('det-notes');
  var allNotes = placeNotes || [];
  if(allNotes.length){
    nl.innerHTML = allNotes.map(function(n){
      var auth = isConfigured ? n.author_name : n.split(':')[0];
      var txt  = isConfigured ? n.content     : n.split(':').slice(1).join(':').trim();
      return '<div class="note"><div class="note-auth">' + auth + '</div><div class="note-txt">' + txt + '</div></div>';
    }).join('');
  } else {
    nl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:6px 0">No notes yet. Be the first!</div>';
  }
  openM('detail');
}

async function addNote(){
  var inp = document.getElementById('note-input');
  var v = inp.value.trim();
  if(!v || !currentPlace) return;
  var authorName = (currentProfile && currentProfile.name) || 'You';

  if(isConfigured){
    var {error} = await sb.from('notes').insert({
      place_id: currentPlace.id,
      author_id: currentUser.id,
      author_name: authorName,
      content: v
    });
    if(error){ toast('Error adding note'); return; }
  } else {
    if(!DEMO_NOTES[currentPlace.id]) DEMO_NOTES[currentPlace.id] = [];
    DEMO_NOTES[currentPlace.id].push(authorName + ': ' + v);
  }
  document.getElementById('det-notes').insertAdjacentHTML('beforeend',
    '<div class="note" style="animation:fu .3s ease both"><div class="note-auth">' + authorName + '</div><div class="note-txt">' + v + '</div></div>');
  inp.value = '';
  toast('Note added');
}

async function markVisited(){
  if(!currentPlace) return;
  if(isConfigured){
    await sb.from('places').update({visited:true}).eq('id', currentPlace.id);
  } else {
    currentPlace.visited = true;
  }
  closeM('detail');
  loadPlaces(currentListId);
  toast('Marked as visited!');
}

/* ═══════════════════════════════════════
   CREATE LIST
═══════════════════════════════════════ */
async function createList(){
  var nameEl = document.getElementById('nl-name');
  var n = nameEl ? nameEl.value.trim() : '';
  if(!n){ toast('Please enter a list name'); return; }
  var swatchEl = document.querySelector('#nl-swatches .swatch.on');
  var color = swatchEl ? swatchEl.style.background : '#C4622D';
  var privMap = {p:'private', s:'shared', pub:'public'};
  var privacy = privMap[curPriv] || 'private';

  var newList;
  if(isConfigured){
    var {data,error} = await sb.from('lists').insert({
      owner_id: currentUser.id,
      title: n,
      description: document.getElementById('nl-desc').value.trim(),
      color: color,
      privacy: privacy
    }).select().single();
    if(error){ toast('Error creating list'); return; }
    newList = data;
  } else {
    newList = {id:'d_'+Date.now(), title:n, color:color, privacy:privacy, owner_id:'demo'};
    DEMO_LISTS.push(newList);
    DEMO_PLACES[newList.id] = [];
  }

  var item = makeSidebarItem(newList);
  var secId = privacy === 'private' ? 'sec-priv' : 'sec-my';
  document.getElementById(secId).appendChild(item);

  if(nameEl) nameEl.value = '';
  var descEl = document.getElementById('nl-desc');
  if(descEl) descEl.value = '';
  closeM('newlist');
  selectList(newList);
  toast('"' + n + '" created!');
}

/* ═══════════════════════════════════════
   ADD PLACE
═══════════════════════════════════════ */
/* ═══════════════════════════════════════
   GOOGLE PLACES SEARCH
═══════════════════════════════════════ */
var placesService      = null;
var autocompleteService= null;
var searchTimer        = null;
var focusedSuggestion  = -1;

// Dynamically load Google Maps only when a real key is provided
(function loadGoogleMapsIfConfigured(){
  if(!GOOGLE_MAPS_KEY || GOOGLE_MAPS_KEY === '') {
    console.info('Google Maps key not set - Places search will use fallback mode');
    return;
  }
  var script = document.createElement('script');
  script.src = 'https://maps.googleapis.com/maps/api/js?key=' +
    GOOGLE_MAPS_KEY + '&libraries=places&callback=initGooglePlaces';
  script.async = true;
  script.defer = true;
  script.onerror = function(){ console.warn('Google Maps failed to load'); };
  document.head.appendChild(script);
})();

// Called by Google Maps script callback
function initGooglePlaces(){
  // We use AutocompleteService (no map needed) + PlacesService (needs a dummy div)
  autocompleteService = new google.maps.places.AutocompleteService();
  var dummyMap = new google.maps.Map(document.createElement('div'));
  placesService = new google.maps.places.PlacesService(dummyMap);
  console.log('Google Places ready');
}

// Trigger search as user types (debounced 350ms)
function onPlacesSearchInput(){
  var input = document.getElementById('ap-search');
  var val   = input.value.trim();
  var clearBtn = document.getElementById('ap-clear');

  clearBtn.style.display = val ? 'flex' : 'none';

  clearTimeout(searchTimer);
  if(!val){ closePlacesDropdown(); return; }

  showPlacesLoading();
  searchTimer = setTimeout(function(){ searchPlaces(val); }, 350);
}

function searchPlaces(query){
  if(!autocompleteService){
    // Fallback if Google Maps not yet loaded or no API key
    showNoResults('Google Maps not available. Check your API key.');
    return;
  }
  autocompleteService.getPlacePredictions(
    { input: query, types: [] },
    function(predictions, status){
      if(status !== google.maps.places.PlacesServiceStatus.OK || !predictions){
        showNoResults('No places found for "' + query + '"');
        return;
      }
      renderSuggestions(predictions);
    }
  );
}

var TYPE_EMOJI = {
  restaurant:'&#127859;', food:'&#127859;', cafe:'&#9749;', bar:'&#127867;',
  bakery:'&#129360;', meal_takeaway:'&#127839;',
  tourist_attraction:'&#127981;', museum:'&#127963;', art_gallery:'&#127912;',
  church:'&#9962;', mosque:'&#128332;', hindu_temple:'&#128334;',
  park:'&#127807;', natural_feature:'&#127956;', campground:'&#26978;',
  lodging:'&#127968;', hotel:'&#127968;',
  shopping_mall:'&#128717;', store:'&#128722;', supermarket:'&#128722;',
  airport:'&#9992;', train_station:'&#128647;', subway_station:'&#128647;',
  hospital:'&#127973;', pharmacy:'&#128138;',
  default:'&#128205;'
};

function getTypeEmoji(types){
  if(!types) return TYPE_EMOJI['default'];
  for(var i=0; i<types.length; i++){
    if(TYPE_EMOJI[types[i]]) return TYPE_EMOJI[types[i]];
  }
  return TYPE_EMOJI['default'];
}

function formatType(types){
  if(!types || !types.length) return 'Place';
  var skip = ['point_of_interest','establishment','political','locality','country'];
  for(var i=0; i<types.length; i++){
    if(skip.indexOf(types[i]) === -1){
      return types[i].replace(/_/g,' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
    }
  }
  return 'Place';
}

function renderSuggestions(predictions){
  var dd = document.getElementById('places-dropdown');
  dd.innerHTML = '';
  focusedSuggestion = -1;

  predictions.slice(0,6).forEach(function(pred, idx){
    var row = document.createElement('div');
    row.className = 'places-suggestion';
    row.setAttribute('data-idx', idx);

    var mainText = pred.structured_formatting.main_text;
    var subText  = pred.structured_formatting.secondary_text || '';
    var emoji    = getTypeEmoji(pred.types);

    row.innerHTML =
      '<div class="places-suggestion-icon">' + emoji + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="places-suggestion-main">' + mainText + '</div>' +
        '<div class="places-suggestion-sub">' + subText + '</div>' +
      '</div>';

    row.addEventListener('click', function(){ selectSuggestion(pred); });
    dd.appendChild(row);
  });

  dd.classList.add('open');
}

function selectSuggestion(pred){
  // Get full place details
  var input = document.getElementById('ap-search');
  input.value = pred.structured_formatting.main_text;
  document.getElementById('ap-clear').style.display = 'flex';
  closePlacesDropdown();
  showPlacesLoading();

  if(!placesService){ showPreviewFallback(pred); return; }

  placesService.getDetails(
    {
      placeId: pred.place_id,
      fields: ['name','formatted_address','geometry','photos','rating','user_ratings_total',
               'types','website','url','price_level','opening_hours','international_phone_number']
    },
    function(place, status){
      if(status !== google.maps.places.PlacesServiceStatus.OK){
        showPreviewFallback(pred);
        return;
      }
      showPlacePreview(place);
    }
  );
}

function showPlacePreview(place){
  selectedPlace = place;

  // Photo
  var imgEl = document.getElementById('pp-img');
  if(place.photos && place.photos.length){
    var photoUrl = place.photos[0].getUrl({maxWidth:600, maxHeight:300});
    imgEl.innerHTML = '<img src="' + photoUrl + '" alt="' + place.name + '" onerror="this.parentElement.innerHTML='<div class=place-preview-img-fallback>&#128205;</div>'">';
  } else {
    imgEl.innerHTML = '<div class="place-preview-img-fallback">&#128205;</div>';
  }

  // Name + address
  document.getElementById('pp-name').textContent = place.name;
  document.getElementById('pp-addr').textContent = place.formatted_address || '';

  // Type
  document.getElementById('pp-type').textContent = formatType(place.types);

  // Rating
  var ratingEl = document.getElementById('pp-rating');
  if(place.rating){
    var stars = '';
    var full  = Math.floor(place.rating);
    for(var i=0; i<full; i++) stars += '&#9733;';
    if(place.rating % 1 >= 0.5) stars += '&#9734;';
    ratingEl.innerHTML = '<span class="stars">' + stars + '</span> ' +
      place.rating.toFixed(1) +
      (place.user_ratings_total ? ' <span style="color:var(--muted);font-weight:400">(' + place.user_ratings_total.toLocaleString() + ')</span>' : '');
  } else {
    ratingEl.innerHTML = '';
  }

  // Google Maps link
  var gmapsEl = document.getElementById('pp-gmaps');
  gmapsEl.href = place.url || ('https://www.google.com/maps/place/?q=place_id:' + place.place_id);

  // Show preview + extra fields
  document.getElementById('place-preview').style.display = 'block';
  document.getElementById('ap-extra').style.display = 'block';
  document.getElementById('places-dropdown').classList.remove('open');

  // Hide loading state
  hidePlacesLoading();

  // Enable submit
  var btn = document.getElementById('ap-submit-btn');
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.cursor  = 'pointer';

  // Auto-pick category from place type
  autoPickCategory(place.types);
}

function showPreviewFallback(pred){
  // Use what we have from autocomplete if getDetails fails
  selectedPlace = {
    name: pred.structured_formatting.main_text,
    formatted_address: pred.structured_formatting.secondary_text || '',
    types: pred.types || [],
    url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(pred.description),
    geometry: null, photos: [], rating: null
  };
  document.getElementById('pp-img').innerHTML = '<div class="place-preview-img-fallback">&#128205;</div>';
  document.getElementById('pp-name').textContent = selectedPlace.name;
  document.getElementById('pp-addr').textContent = selectedPlace.formatted_address;
  document.getElementById('pp-type').textContent = formatType(selectedPlace.types);
  document.getElementById('pp-rating').innerHTML = '';
  document.getElementById('pp-gmaps').href = selectedPlace.url;
  document.getElementById('place-preview').style.display = 'block';
  document.getElementById('ap-extra').style.display = 'block';
  hidePlacesLoading();
  var btn = document.getElementById('ap-submit-btn');
  btn.disabled = false; btn.style.opacity='1'; btn.style.cursor='pointer';
  autoPickCategory(selectedPlace.types);
}

function autoPickCategory(types){
  if(!types) return;
  var sel = document.getElementById('ap-cat');
  var foodTypes    = ['restaurant','food','cafe','bar','bakery','meal_takeaway','meal_delivery'];
  var cultureTypes = ['museum','art_gallery','tourist_attraction','church','mosque','hindu_temple','amusement_park','stadium'];
  var natureTypes  = ['park','natural_feature','campground','zoo','aquarium'];
  var shopTypes    = ['shopping_mall','store','clothing_store','supermarket','department_store'];
  var stayTypes    = ['lodging','hotel','campground'];

  for(var i=0;i<types.length;i++){
    if(foodTypes.indexOf(types[i])   !== -1){ sel.value='Food and Drink'; return; }
    if(cultureTypes.indexOf(types[i])!== -1){ sel.value='Culture and Sights'; return; }
    if(natureTypes.indexOf(types[i]) !== -1){ sel.value='Nature and Parks'; return; }
    if(shopTypes.indexOf(types[i])   !== -1){ sel.value='Shopping'; return; }
    if(stayTypes.indexOf(types[i])   !== -1){ sel.value='Accommodation'; return; }
  }
}

function showPlacesLoading(){
  var dd = document.getElementById('places-dropdown');
  dd.innerHTML =
    '<div class="places-loading">' +
    '<div class="places-loading-dot"></div>' +
    '<div class="places-loading-dot"></div>' +
    '<div class="places-loading-dot"></div>' +
    '<span style="margin-left:4px;font-size:12px">Searching...</span>' +
    '</div>';
  dd.classList.add('open');
}
function hidePlacesLoading(){
  var dd = document.getElementById('places-dropdown');
  dd.classList.remove('open');
  dd.innerHTML = '';
}
function showNoResults(msg){
  var dd = document.getElementById('places-dropdown');
  dd.innerHTML = '<div class="places-no-results">&#128269; ' + msg + '</div>';
  dd.classList.add('open');
}
function closePlacesDropdown(){
  var dd = document.getElementById('places-dropdown');
  dd.classList.remove('open');
}

function clearPlaceSearch(){
  document.getElementById('ap-search').value = '';
  document.getElementById('ap-clear').style.display = 'none';
  document.getElementById('place-preview').style.display = 'none';
  document.getElementById('ap-extra').style.display = 'none';
  var btn = document.getElementById('ap-submit-btn');
  btn.disabled = true; btn.style.opacity='.45'; btn.style.cursor='not-allowed';
  closePlacesDropdown();
  selectedPlace = null;
}

// Keyboard navigation on dropdown
document.addEventListener('keydown', function(e){
  var dd = document.getElementById('places-dropdown');
  if(!dd || !dd.classList.contains('open')) return;
  var items = dd.querySelectorAll('.places-suggestion');
  if(!items.length) return;
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    focusedSuggestion = Math.min(focusedSuggestion+1, items.length-1);
  } else if(e.key === 'ArrowUp'){
    e.preventDefault();
    focusedSuggestion = Math.max(focusedSuggestion-1, 0);
  } else if(e.key === 'Escape'){
    closePlacesDropdown();
    return;
  } else { return; }
  items.forEach(function(el,i){ el.classList.toggle('focused', i===focusedSuggestion); });
  items[focusedSuggestion].scrollIntoView({block:'nearest'});
});

// Close dropdown when clicking outside
document.addEventListener('click', function(e){
  if(!e.target.closest('#m-addplace')) closePlacesDropdown();
});

/* ═══════════════════════════════════════
   ADD PLACE (uses selectedPlace data)
═══════════════════════════════════════ */
async function addPlace(){
  // If no place selected from Google Maps, fall back to manual input
  if(!selectedPlace){
    var manualName = document.getElementById('ap-search') ?
      document.getElementById('ap-search').value.trim() : '';
    if(!manualName){ toast('Please enter a place name'); return; }
    selectedPlace = {
      name: manualName,
      formatted_address: '',
      types: [],
      url: 'https://www.google.com/maps/search/' + encodeURIComponent(manualName),
      geometry: null, photos: [], rating: null, place_id: null
    };
    document.getElementById('ap-extra').style.display = 'block';
    var btn = document.getElementById('ap-submit-btn');
    if(btn){ btn.disabled=false; btn.style.opacity='1'; btn.style.cursor='pointer'; }
  }

  var cat  = document.getElementById('ap-cat').value;
  var note = document.getElementById('ap-note').value.trim();
  var vis  = document.getElementById('ap-vis').checked;

  var name  = selectedPlace.name;
  var addr  = selectedPlace.formatted_address || '';
  var lat   = (selectedPlace.geometry && selectedPlace.geometry.location)
              ? selectedPlace.geometry.location.lat() : null;
  var lng   = (selectedPlace.geometry && selectedPlace.geometry.location)
              ? selectedPlace.geometry.location.lng() : null;
  var placeId = selectedPlace.place_id || null;
  var mapsUrl = selectedPlace.url || null;

  // Pick colour pair based on category
  var colorMap = {
    'Food and Drink':   ['#C4622D','#E8895A'],
    'Culture and Sights':['#6B4C9A','#9B7CC4'],
    'Nature and Parks': ['#4A7C59','#7EAF8E'],
    'Shopping':         ['#2D6B8C','#5A9BBF'],
    'Accommodation':    ['#8B4513','#D2691E'],
    'Entertainment':    ['#C44B6B','#E07090'],
  };
  var colors = colorMap[cat] || ['#8B7D6B','#B5A898'];

  var newPlace;
  if(isConfigured){
    var insertData = {
      list_id:    currentListId,
      added_by:   currentUser.id,
      name:       name,
      address:    addr,
      category:   cat,
      color1:     colors[0],
      color2:     colors[1],
      emoji:      'pin',
      visited:    vis,
      lat:        lat,
      lng:        lng,
      place_id:   placeId,
      maps_url:   mapsUrl
    };
    var {data,error} = await sb.from('places').insert(insertData).select().single();
    if(error){ toast('Error adding place: ' + error.message); return; }
    newPlace = data;
    if(note){
      await sb.from('notes').insert({
        place_id:    newPlace.id,
        author_id:   currentUser.id,
        author_name: (currentProfile && currentProfile.name) || 'You',
        content:     note
      });
    }
  } else {
    newPlace = {
      id:'p_'+Date.now(), list_id:currentListId,
      name:name, address:addr, category:cat,
      color1:colors[0], color2:colors[1],
      emoji:'pin', visited:vis,
      lat:lat, lng:lng, place_id:placeId, maps_url:mapsUrl
    };
    DEMO_PLACES[currentListId] = DEMO_PLACES[currentListId] || [];
    DEMO_PLACES[currentListId].push(newPlace);
    if(note) DEMO_NOTES[newPlace.id] = ['You: ' + note];
  }

  clearPlaceSearch();
  closeM('addplace');
  loadPlaces(currentListId);
  toast('&#128205; ' + name + ' added!');
}

/* ═══════════════════════════════════════
   DELETE LIST
═══════════════════════════════════════ */
function askDeleteList(list){
  showConfirm('&#128465;&#65039;','Delete "' + list.title + '"?','All places will be permanently removed.','Delete',
    function(){ doDeleteList(list); });
}
async function doDeleteList(list){
  if(isConfigured){
    var {error} = await sb.from('lists').delete().eq('id', list.id);
    if(error){ toast('Error deleting list'); return; }
  } else {
    DEMO_LISTS = DEMO_LISTS.filter(function(l){ return l.id !== list.id; });
    delete DEMO_PLACES[list.id];
  }
  var item = document.querySelector('.li[data-id="' + list.id + '"]');
  if(item) item.remove();
  if(currentListId === list.id){
    var first = document.querySelector('.li');
    if(first){
      var fid = first.getAttribute('data-id');
      var flist = isConfigured ? {id:fid, title:first.querySelector('.li-name').textContent} : DEMO_LISTS.find(function(l){ return l.id===fid; });
      if(flist) selectList(flist);
    } else { renderEmpty(); }
  }
  toast('List deleted');
}

/* ═══════════════════════════════════════
   DELETE PLACE
═══════════════════════════════════════ */
function askDeletePlace(place){
  showConfirm('&#128205;','Remove "' + place.name + '"?','It will be removed from this list.','Remove',
    function(){ doDeletePlace(place); });
}
async function doDeletePlace(place){
  if(isConfigured){
    var {error} = await sb.from('places').delete().eq('id', place.id);
    if(error){ toast('Error removing place'); return; }
  } else {
    DEMO_PLACES[currentListId] = (DEMO_PLACES[currentListId]||[]).filter(function(p){ return p.id !== place.id; });
  }
  loadPlaces(currentListId);
  toast('Place removed');
}

/* ═══════════════════════════════════════
   ADMIN PANEL
═══════════════════════════════════════ */
function toggleAdminPanel(){
  var role = currentProfile && currentProfile.role;
  if(role === 'admin' || (currentUser && currentUser.id === 'demo')){
    openM('admin');
    loadAdminData();
  }
}

async function loadAdminData(){
  if(!isConfigured){
    document.getElementById('stat-users').textContent  = '3';
    document.getElementById('stat-lists').textContent  = DEMO_LISTS.length;
    document.getElementById('stat-places').textContent = Object.values(DEMO_PLACES).reduce(function(a,v){ return a+v.length; }, 0);
    document.getElementById('stat-notes').textContent  = Object.values(DEMO_NOTES).reduce(function(a,v){ return a+v.length; }, 0);
    document.getElementById('admin-user-list').innerHTML =
      '<div class="user-row"><span>Demo User<br><small style="color:var(--muted)">demo@wanderlist.app</small></span><span>Now</span><span><span class="role-badge role-admin">Admin</span></span><span>-</span></div>' +
      '<div class="user-row"><span>Mia Park<br><small style="color:var(--muted)">mia@example.com</small></span><span>Jan 2025</span><span><span class="role-badge role-user">User</span></span><span>-</span></div>' +
      '<div class="user-row"><span>Tom Wu<br><small style="color:var(--muted)">tom@example.com</small></span><span>Feb 2025</span><span><span class="role-badge role-user">User</span></span><span>-</span></div>';
    return;
  }
  var [pRes, lRes, plRes, nRes] = await Promise.all([
    sb.from('profiles').select('count',{count:'exact',head:true}),
    sb.from('lists').select('count',{count:'exact',head:true}),
    sb.from('places').select('count',{count:'exact',head:true}),
    sb.from('notes').select('count',{count:'exact',head:true})
  ]);
  document.getElementById('stat-users').textContent  = pRes.count  || 0;
  document.getElementById('stat-lists').textContent  = lRes.count  || 0;
  document.getElementById('stat-places').textContent = plRes.count || 0;
  document.getElementById('stat-notes').textContent  = nRes.count  || 0;

  var {data:users} = await sb.from('profiles').select('*').order('created_at');
  var ul = document.getElementById('admin-user-list');
  ul.innerHTML = '';
  (users||[]).forEach(function(u){
    var row = document.createElement('div');
    row.className = 'user-row';
    var joined = u.created_at ? new Date(u.created_at).toLocaleDateString('en',{month:'short',year:'numeric'}) : '-';
    row.innerHTML =
      '<span>' + (u.name||'Unknown') + '<br><small style="color:var(--muted)">' + (u.id.slice(0,8)+'...') + '</small></span>' +
      '<span>' + joined + '</span>' +
      '<span><span class="role-badge ' + (u.role==='admin'?'role-admin':'role-user') + '">' + (u.role||'user') + '</span></span>' +
      '<button class="btn btn-s" style="padding:4px 8px;font-size:11px" onclick="toggleUserRole(\'' + u.id + '\',\'' + (u.role||'user') + '\')">' +
      (u.role==='admin' ? 'Demote' : 'Make Admin') + '</button>';
    ul.appendChild(row);
  });
}

async function toggleUserRole(uid, currentRole){
  var newRole = currentRole === 'admin' ? 'user' : 'admin';
  await sb.from('profiles').update({role:newRole}).eq('id',uid);
  loadAdminData();
  toast('Role updated to ' + newRole);
}

/* ═══════════════════════════════════════
   INVITE
═══════════════════════════════════════ */
function invitePerson(){
  var el = document.getElementById('inv-email');
  var email = el ? el.value.trim() : '';
  if(!email) return;
  var init = email[0].toUpperCase();
  document.getElementById('inv-list').insertAdjacentHTML('beforeend',
    '<div class="inv-person"><div class="cav" style="background:linear-gradient(135deg,#6B4C9A,#9B7CC4);border:none">' + init + '</div>' +
    '<span class="inv-name">' + email + '</span><span class="inv-role">Can edit</span></div>');
  if(el) el.value = '';
  toast('Invite sent to ' + email);
}

/* ═══════════════════════════════════════
   SIDEBAR TOGGLE
═══════════════════════════════════════ */
function isMob(){ return window.innerWidth <= 680; }
function toggleSB(){
  if(isMob()){ openMobile(); }
  else { dkCollapsed=!dkCollapsed; document.getElementById('sidebar').classList.toggle('collapsed',dkCollapsed); }
}
function openMobile(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('backdrop').classList.add('on');
}
function closeMobile(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('on');
}
window.addEventListener('resize', function(){ if(!isMob()) closeMobile(); });

/* ═══════════════════════════════════════
   HELPERS
═══════════════════════════════════════ */
function openM(id){
  var el = document.getElementById('m-'+id);
  if(!el) return;
  el.classList.add('on');
  if(id === 'addplace'){
    var inp = document.getElementById('ap-search');
    if(inp && !inp._wired){
      inp.addEventListener('input', onPlacesSearchInput);
      inp._wired = true;
    }
  }
}
function closeM(id){
  var el = document.getElementById('m-'+id);
  if(el) el.classList.remove('on');
}
document.querySelectorAll('.moverlay').forEach(function(el){
  el.addEventListener('click', function(e){ if(e.target===el) el.classList.remove('on'); });
});
function copyLink(){
  var link = 'https://waleedju88.github.io/wanderlist/?list=' + currentListId;
  if(navigator.clipboard) navigator.clipboard.writeText(link).catch(function(){});
  document.getElementById('sharelink').value = link;
  toast('Link copied!');
}
function navTo(q, mapsUrl){
  var url = mapsUrl || ('https://www.google.com/maps/search/' + encodeURIComponent(q));
  window.open(url, '_blank');
}
function navPlace(){ if(currentPlace) navTo(currentPlace.name + ' ' + (currentPlace.address||''), currentPlace.maps_url); }
function openMapView(){
  var content = document.getElementById('main-content');
  var names = [];
  content.querySelectorAll('.pcard-name').forEach(function(el){ names.push(el.textContent); });
  window.open('https://www.google.com/maps/search/' + encodeURIComponent(names.join('+') || 'travel places'), '_blank');
}
function setView(v, el){ document.querySelectorAll('.vtab').forEach(function(t){t.classList.remove('on');}); el.classList.add('on'); if(v==='map') openMapView(); }
function setNav(el){ document.querySelectorAll('.bnav-btn').forEach(function(b){b.classList.remove('on');}); el.classList.add('on'); }
function pickSwatch(el){ el.closest('.swatches').querySelectorAll('.swatch').forEach(function(s){s.classList.remove('on');}); el.classList.add('on'); }
function pickPriv(el, type){
  curPriv = type;
  el.closest('.priv-opts').querySelectorAll('.popt').forEach(function(o){o.className='popt';});
  el.classList.add(type==='p'?'sp':type==='s'?'ss':'spub');
}
var toastTimer;
function toast(msg){ var t=document.getElementById('toastEl'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.classList.remove('on');},2500); }
var confirmCb=null;
function showConfirm(icon,title,msg,okLbl,cb){ document.getElementById('confirmIcon').innerHTML=icon; document.getElementById('confirmTitle').textContent=title; document.getElementById('confirmMsg').textContent=msg; document.getElementById('confirmOkBtn').textContent=okLbl; confirmCb=cb; document.getElementById('confirmOverlay').classList.add('on'); }
function dismissConfirm(){ document.getElementById('confirmOverlay').classList.remove('on'); confirmCb=null; }
function confirmOk(){ document.getElementById('confirmOverlay').classList.remove('on'); if(confirmCb) confirmCb(); confirmCb=null; }

/* ═══════════════════════════════════════
   BOOT
═══════════════════════════════════════ */

// Show login page immediately — do not wait for anything
(function showLoginImmediately(){
  var loginPage = document.getElementById('page-login');
  if(loginPage) loginPage.classList.add('active');
})();

// Wire up all auth buttons via JS (more reliable than inline onclick on iOS Safari)
document.addEventListener('DOMContentLoaded', function(){
  // Tab switching
  var tabLogin  = document.getElementById('tab-login');
  var tabSignup = document.getElementById('tab-signup');
  if(tabLogin)  tabLogin.addEventListener('click',  function(){ showAuthTab('login'); });
  if(tabSignup) tabSignup.addEventListener('click', function(){ showAuthTab('signup'); });

  // Sign in button
  var btnSignIn = document.querySelector('#form-login .btn-terra');
  if(btnSignIn) btnSignIn.addEventListener('click', signInEmail);

  // Sign up button
  var btnSignUp = document.querySelector('#form-signup .btn-terra');
  if(btnSignUp) btnSignUp.addEventListener('click', signUpEmail);

  // Google buttons
  document.querySelectorAll('.btn-google').forEach(function(btn){
    btn.addEventListener('click', signInGoogle);
  });

  // Forgot password
  var forgotLink = document.querySelector('.forgot-link a');
  if(forgotLink) forgotLink.addEventListener('click', showForgot);

  // Enter key on password fields
  var loginPass = document.getElementById('login-password');
  if(loginPass) loginPass.addEventListener('keydown', function(e){
    if(e.key === 'Enter') signInEmail();
  });
  var signupPass = document.getElementById('signup-password');
  if(signupPass) signupPass.addEventListener('keydown', function(e){
    if(e.key === 'Enter') signUpEmail();
  });
});

// Then run the full boot once DOM + scripts are ready
document.addEventListener('DOMContentLoaded', function(){
  boot();
});

// Safety fallback — if DOMContentLoaded already fired, run now
if(document.readyState === 'complete' || document.readyState === 'interactive'){
  setTimeout(boot, 0);
}

var bootRan = false;
async function boot(){
  if(bootRan) return;
  bootRan = true;
  try {
    if(!isConfigured || !sb){
      showPage('login');
      return;
    }
    var result = await sb.auth.getSession();
    var session = result && result.data && result.data.session;
    if(session && session.user){
      onSignedIn(session.user);
    } else {
      showPage('login');
    }
    sb.auth.onAuthStateChange(function(event, session){
      if(event === 'SIGNED_IN' && session) onSignedIn(session.user);
      if(event === 'SIGNED_OUT') showPage('login');
    });
  } catch(e){
    console.error('Boot error:', e);
    showPage('login');
  }
}
// ── WIRE UP ALL BUTTONS VIA addEventListener (no inline onclick) ──
document.addEventListener('DOMContentLoaded', function runWire(){
(function wireButtons(){
  function on(id, ev, fn){ var el=document.getElementById(id); if(el) el.addEventListener(ev,fn); }
  function onAll(sel, ev, fn){ document.querySelectorAll(sel).forEach(function(el){ el.addEventListener(ev,fn); }); }

  // Auth tabs
  on('tab-login',  'click', function(){ showAuthTab('login'); });
  on('tab-signup', 'click', function(){ showAuthTab('signup'); });

  // Auth buttons
  on('btn-signin',       'click', signInEmail);
  on('btn-signup',       'click', signUpEmail);
  on('btn-google-signin','click', signInGoogle);
  on('btn-google-signup','click', signInGoogle);
  on('btn-forgot',       'click', showForgot);

  // Enter key on inputs
  on('login-password',  'keydown', function(e){ if(e.key==='Enter') signInEmail(); });
  on('signup-password', 'keydown', function(e){ if(e.key==='Enter') signUpEmail(); });

  // App buttons
  on('btn-ham',       'click', toggleSB);
  on('btn-newlist',   'click', function(){ openM('newlist'); });
  on('btn-add-top',   'click', function(){ openM('addplace'); });
  on('btn-share-top', 'click', function(){ openM('share'); });
  on('btn-signout',   'click', signOut);
  on('sb-user-btn',   'click', toggleAdminPanel);
  on('backdrop',      'click', closeMobile);

  // Bottom nav
  on('bnav-lists', 'click', function(){ toggleSB(); setNav(document.getElementById('bnav-lists')); });
  on('bnav-map',   'click', function(){ openMapView(); setNav(document.getElementById('bnav-map')); });
  on('bnav-add',   'click', function(){ openM('addplace'); setNav(document.getElementById('bnav-add')); });
  on('bnav-share', 'click', function(){ openM('share'); setNav(document.getElementById('bnav-share')); });

  // View tabs
  on('btn-view-grid', 'click', function(){ setView('grid', document.getElementById('btn-view-grid')); });
  on('btn-view-map',  'click', function(){ setView('map',  document.getElementById('btn-view-map')); });

  // Modal close buttons
  on('close-newlist',  'click', function(){ closeM('newlist'); });
  on('cancel-newlist', 'click', function(){ closeM('newlist'); });
  on('submit-newlist', 'click', createList);
  on('close-addplace', 'click', function(){ closeM('addplace'); clearPlaceSearch(); });
  on('cancel-addplace','click', function(){ closeM('addplace'); clearPlaceSearch(); });
  on('submit-addplace','click', addPlace);
  on('close-share',    'click', function(){ closeM('share'); });
  on('done-share',     'click', function(){ closeM('share'); toast('Saved'); });
  on('btn-copylink',   'click', copyLink);
  on('btn-invite',     'click', invitePerson);
  on('close-detail',   'click', function(){ closeM('detail'); });
  on('btn-addnote',    'click', addNote);
  on('btn-markvisited','click', markVisited);
  on('btn-navigate',   'click', navPlace);
  on('det-maplink',    'click', navPlace);
  on('close-admin',    'click', function(){ closeM('admin'); });
  on('confirm-cancel', 'click', dismissConfirm);
  on('confirm-ok',     'click', confirmOk);
  on('ap-clear',       'click', clearPlaceSearch);

  // Swatches
  onAll('#nl-swatches .swatch', 'click', function(){ pickSwatch(this); });

  // Privacy options
  onAll('#nl-priv .popt', 'click', function(){ pickPriv(this, this.getAttribute('data-priv')); });

  // Places search
  on('ap-search', 'input', onPlacesSearchInput);
  on('btn-close-banner', 'click', function(){
    var b = document.getElementById('setup-banner');
    if(b) b.style.display = 'none';
  });

  // Modal overlay click to close
  document.querySelectorAll('.moverlay').forEach(function(el){
    el.addEventListener('click', function(e){ if(e.target===el) el.classList.remove('on'); });
  });
})();
}); // end DOMContentLoaded runWire
