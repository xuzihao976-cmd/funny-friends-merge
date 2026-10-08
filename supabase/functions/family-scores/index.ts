// No keys are embedded here. Supabase injects backend-only keys at runtime.
const projectUrl = Deno.env.get('SUPABASE_URL')!;
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
const serverKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const publicKeys = Object.values(publishableKeys).filter(v => typeof v === 'string');
const legacyAnon = Deno.env.get('SUPABASE_ANON_KEY');
if (legacyAnon) publicKeys.push(legacyAnon);
const hex = (bytes: Uint8Array) => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const digest = async (token: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
const allowedOrigin = (origin: string) => origin === 'https://xuzihao976-cmd.github.io' || /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(origin);
async function rpc(name: string, body: Record<string, unknown>) {
  if (!serverKey) throw Error('Backend unavailable');
  const headers: Record<string,string> = {apikey:serverKey,'Content-Type':'application/json'};
  if (serverKey.startsWith('eyJ')) headers.Authorization='Bearer '+serverKey;
  const response = await fetch(projectUrl+'/rest/v1/rpc/'+name, {
    method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const data = await response.json().catch(()=>({}));
    throw Error(data.message || 'Backend unavailable');
  }
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers: Record<string,string> = {
    'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'apikey, content-type',
    'Access-Control-Max-Age':'600'
  };
  if (origin && allowedOrigin(origin)) headers['Access-Control-Allow-Origin']=origin;
  const reply = (data: unknown, status=200) => new Response(JSON.stringify(data),{status,headers});
  if (origin && !allowedOrigin(origin)) return reply({error:'origin_not_allowed'},403);
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (req.method!=='POST') return reply({error:'method_not_allowed'},405);
  if (!publicKeys.includes(req.headers.get('apikey') || '')) return reply({error:'invalid_api_key'},401);
  if (!(req.headers.get('content-type') || '').includes('application/json')) return reply({error:'json_required'},415);
  if (Number(req.headers.get('content-length') || 0)>4096) return reply({error:'body_too_large'},413);
  try {
    const raw=await req.text();
    if (raw.length>4096) return reply({error:'body_too_large'},413);
    const body=JSON.parse(raw);
    if (!body || typeof body!=='object' || Array.isArray(body)) return reply({error:'invalid_request'},400);
    if (body.action==='session') {
      const token=hex(crypto.getRandomValues(new Uint8Array(32)));
      await rpc('register_family_guest',{p_token_hash:await digest(token)});
      return reply({token});
    }
    if (body.action!=='score') return reply({error:'invalid_action'},400);
    // A visitor must prove possession of a 256-bit server-issued token.
    if (typeof body.token!=='string' || !/^[0-9a-f]{64}$/.test(body.token)) return reply({error:'invalid_session'},401);
    if (!Number.isSafeInteger(body.points) || body.points<1 || body.points>10000000
       || !['photo','comic'].includes(body.mode)
       || typeof body.runId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.runId)
       || typeof body.nickname!=='string') return reply({error:'invalid_score'},400);
    const nickname=body.nickname.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,12);
    if (!nickname) return reply({error:'invalid_nickname'},400);
    await rpc('submit_family_guest_score',{
      p_token_hash:await digest(body.token),p_run_id:body.runId,p_nickname:nickname,p_points:body.points,p_game_mode:body.mode
    });
    return reply({ok:true});
  } catch (error) {
    const message=error instanceof Error ? error.message : '';
    if (message.includes('Invalid guest session')) return reply({error:'invalid_session'},401);
    if (message.includes('Daily score')) return reply({error:'daily_limit'},429);
    if (message.includes('too frequent')) { headers['Retry-After']='4'; return reply({error:'too_frequent'},429); }
    if (message.includes('Guest creation limit')) return reply({error:'guest_limit'},429);
    if (message.includes('Invalid score') || error instanceof SyntaxError) return reply({error:'invalid_score'},400);
    return reply({error:'temporarily_unavailable'},503);
  }
});
