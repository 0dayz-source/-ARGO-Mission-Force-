/* ============================================================================
   ARGO — 방명록 자동 분류 (Supabase Edge Function)
   ----------------------------------------------------------------------------
   왜 서버인가 : AI Secret API Key 는 브라우저에도 GitHub 에도 두면 안 된다.
                 이 함수만 키를 알고, 프론트는 이 함수의 존재조차 몰라도 된다.

   [ 동작 ]
   classification_status='pending' 인 방명록을 배치로 읽어 분류하고 결과 컬럼만 채운다.
   · message 원문은 절대 건드리지 않는다 (UPDATE 대상에 message 가 없다).
   · AI 호출이 실패하면 그 행만 failed 로 표시하고 나머지는 계속 처리한다.
   · 이 함수를 아예 배포하지 않아도 방명록 저장은 정상 완료되고 pending 으로 남는다.

   [ 배포 ]
     supabase functions deploy classify-guestbook
     supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Edge 런타임이 자동 주입한다.
    service_role 키는 오직 여기서만 쓰인다 — 프론트로 내보내지 말 것.)

   [ 실행 ] Dashboard → Database → Cron 으로 주기 호출하거나 수동 invoke.
   ============================================================================ */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AI_KEY       = Deno.env.get('ANTHROPIC_API_KEY');       // 없으면 분류를 건너뛴다
const MODEL        = 'claude-sonnet-5';
const VERSION      = 'gb-classify-1.0.0';                      // classification_version 에 기록
const BATCH        = 20;

const CATEGORIES = [
  'EXHIBITION_EXPERIENCE',   // 전시 관람 경험 전반
  'MARS_OPINION',            // 화성 이주/설정에 대한 의견
  'DESIGN_INTERACTION',      // 디자인·인터랙션·기술에 대한 언급
  'EMOTIONAL_REACTION',      // 감정 반응(감탄·소름·재미 등)
  'SUGGESTION',              // 제안·개선 요청
  'OTHER'
] as const;

const SYSTEM = `너는 전시 방명록 분류기다. 한국어/영어 방명록 한 편을 읽고 JSON 만 출력한다.
설명·서론·코드펜스 없이 순수 JSON 객체 하나만 출력할 것.

{
  "primary_category": ${JSON.stringify(CATEGORIES)} 중 하나,
  "secondary_categories": 위 목록의 부분집합 배열 (없으면 []),
  "sentiment": "positive" | "neutral" | "negative" | "mixed",
  "keywords": 원문에서 뽑은 핵심어 배열 (최대 5개, 원문 표현 그대로),
  "confidence": 0.0 ~ 1.0
}

규칙:
- 한 글에 여러 주제가 섞이면 가장 비중이 큰 것을 primary 로, 나머지를 secondary 에 넣는다.
- 어디에도 맞지 않으면 primary_category 는 "OTHER" 로 한다.
- 개인정보(이름·연락처)는 keywords 에 넣지 않는다.`;

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!r.ok) throw new Error(`sb_${r.status}: ${await r.text()}`);
  return r;
}

async function classify(message: string) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': AI_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: message }]
    })
  });
  if (!r.ok) throw new Error(`ai_${r.status}`);
  const data = await r.json();
  const text = (data?.content?.[0]?.text ?? '').trim();
  const parsed = JSON.parse(text);          // 형식이 어긋나면 throw → 그 행만 failed
  if (!CATEGORIES.includes(parsed.primary_category)) throw new Error('bad_category');
  return parsed;
}

Deno.serve(async () => {
  // AI 설정이 없으면 조용히 아무것도 하지 않는다 — 방명록은 pending 으로 남아 있으면 된다.
  if (!AI_KEY) {
    return Response.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  const rows = await (await sb(
    `guestbook_entries?classification_status=eq.pending&select=guestbook_id,message&limit=${BATCH}`
  )).json();

  let done = 0, failed = 0;
  for (const row of rows) {
    try {
      const c = await classify(row.message);
      // message 는 UPDATE 대상에 없다 — 원문은 어떤 경우에도 덮이지 않는다.
      await sb(`guestbook_entries?guestbook_id=eq.${row.guestbook_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          primary_category: c.primary_category,
          secondary_categories: c.secondary_categories ?? [],
          sentiment: c.sentiment ?? null,
          keywords: c.keywords ?? [],
          classification_confidence: c.confidence ?? null,
          classification_version: VERSION,
          classification_status: 'completed'
        })
      });
      done++;
    } catch (e) {
      failed++;
      await sb(`guestbook_entries?guestbook_id=eq.${row.guestbook_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ classification_status: 'failed', classification_version: VERSION })
      }).catch(() => {});
      console.error('classify failed', row.guestbook_id, String(e).slice(0, 120));
    }
  }
  return Response.json({ picked: rows.length, done, failed });
});
