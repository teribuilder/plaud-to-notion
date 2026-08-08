// 노션 적재 계층. DB 생성·속성 자동 보정·마크다운 → 블록 변환을 담당한다.
const VERSION = '2022-06-28';

// 사람마다 DB 속성 이름이 다르므로 후보군으로 찾고, 없으면 만들어 준다.
export const PROP_SPEC = {
  plaudId:  { type: 'rich_text', names: ['PlaudID', 'Plaud ID', 'plaud_id'], create: 'PlaudID' },
  date:     { type: 'date',      names: ['날짜', 'Date', '생성일', 'Created'], create: '날짜' },
  duration: { type: 'rich_text', names: ['재생시간', '길이', 'Duration'], create: '재생시간' },
  url:      { type: 'url',       names: ['URL', 'Url', '링크', 'Link'], create: 'URL' },
  source:   { type: 'select',    names: ['출처', 'Source'], create: '출처' },
  summary:  { type: 'rich_text', names: ['요약', 'Summary', '요약(텍스트)'], create: '요약' },
};

export function notion(token) {
  return async function call(method, path, body) {
    const res = await fetch('https://api.notion.com/v1' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) {
      const hint = json.code === 'object_not_found'
        ? ' (통합이 해당 페이지/DB에 연결되어 있는지 확인하세요)'
        : '';
      throw new Error(`Notion ${method} ${path} → ${res.status} ${json.code}: ${json.message}${hint}`);
    }
    return json;
  };
}

export async function createDatabase(call, parentPageId, title = 'Plaud 노트') {
  return call('POST', '/databases', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: title } }],
    properties: {
      '이름': { title: {} },
      'PlaudID': { rich_text: {} },
      '날짜': { date: {} },
      '재생시간': { rich_text: {} },
      'URL': { url: {} },
      '출처': { select: { options: [{ name: '플라우드', color: 'purple' }] } },
      '요약': { rich_text: {} },
    },
  });
}

// 기존 DB를 쓰는 경우: 있는 속성은 그대로 쓰고, 없는 것만 추가한다 (기존 데이터는 건드리지 않는다)
export async function resolveSchema(call, dbId, { autoAdd = true } = {}) {
  let db = await call('GET', '/databases/' + dbId);
  const find = (spec) => {
    const p = db.properties;
    return spec.names.find((n) => p[n]?.type === spec.type)
      || Object.keys(p).find((k) => p[k].type === spec.type && spec.names.some((n) => k.includes(n)))
      || null;
  };

  const missing = {};
  const schema = { title: Object.keys(db.properties).find((k) => db.properties[k].type === 'title') };
  for (const [key, spec] of Object.entries(PROP_SPEC)) {
    const found = find(spec);
    if (found) { schema[key] = found; continue; }
    if (!autoAdd) continue;
    missing[spec.create] = spec.type === 'select'
      ? { select: { options: [{ name: '플라우드', color: 'purple' }] } }
      : { [spec.type]: {} };
    schema[key] = spec.create;
  }
  if (Object.keys(missing).length) {
    db = await call('PATCH', '/databases/' + dbId, { properties: missing });
  }
  schema.props = db.properties;
  return schema;
}

export async function findByPlaudId(call, dbId, schema, plaudId) {
  if (!schema.plaudId) return null;
  const r = await call('POST', `/databases/${dbId}/query`, {
    page_size: 1,
    filter: { property: schema.plaudId, rich_text: { equals: plaudId } },
  });
  return r.results[0] || null;
}

const text = (s) => ({ type: 'text', text: { content: String(s).slice(0, 1900) } });
const paragraph = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [text(s)] } });

function inlineRich(line) {
  const out = [];
  for (const part of line.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    out.push(bold
      ? { type: 'text', text: { content: bold[1].slice(0, 1900) }, annotations: { bold: true } }
      : text(part));
  }
  return out.length ? out.slice(0, 100) : [text('')];
}

// Plaud 요약은 마크다운으로 온다. 헤딩·불릿·인용을 노션 블록으로 옮긴다.
export function markdownToBlocks(md) {
  const blocks = [];
  for (const raw of String(md).split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^-{3,}$/.test(line.trim())) { blocks.push({ object: 'block', type: 'divider', divider: {} }); continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const type = `heading_${m[1].length}`;
      blocks.push({ object: 'block', type, [type]: { rich_text: inlineRich(m[2]) } });
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: inlineRich(m[1]) } });
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: inlineRich(m[1]) } });
    } else if ((m = line.match(/^>\s+(.*)$/))) {
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: inlineRich(m[1]) } });
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: inlineRich(line) } });
    }
  }
  return blocks;
}

// 노션 리치텍스트는 2000자 제한이 있어 줄 경계를 지키며 나눈다
export function chunkLines(lines, max = 1900) {
  const out = [];
  let buf = '';
  for (const line of lines) {
    if (buf.length + line.length + 1 > max) { out.push(paragraph(buf)); buf = ''; }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) out.push(paragraph(buf));
  return out;
}

export async function createNotePage(call, dbId, schema, note, { summaryMd, transcript, includeTranscript = true, sourceLabel = '플라우드', headings = { summary: '요약', transcript: '전사본' } }) {
  const properties = {};
  properties[schema.title] = { title: [text(note.title)] };
  if (schema.plaudId) properties[schema.plaudId] = { rich_text: [text(note.id)] };
  if (schema.date) properties[schema.date] = { date: { start: note.dateIso } };
  if (schema.duration) properties[schema.duration] = { rich_text: [text(note.duration)] };
  if (schema.url) properties[schema.url] = { url: note.url };
  if (schema.summary && summaryMd) properties[schema.summary] = { rich_text: [text(summaryMd.replace(/[#*>]/g, ''))] };
  if (schema.source) {
    const options = schema.props[schema.source]?.select?.options?.map((o) => o.name) || [];
    properties[schema.source] = { select: { name: options.find((o) => o === sourceLabel) || sourceLabel } };
  }

  const blocks = [];
  if (summaryMd) {
    blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: [text(headings.summary)] } });
    blocks.push(...markdownToBlocks(summaryMd));
  }
  if (includeTranscript && transcript?.length) {
    blocks.push({ object: 'block', type: 'divider', divider: {} });
    blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: [text(headings.transcript)] } });
    blocks.push(...chunkLines(transcript));
  }

  // 페이지 생성 시 자식 블록은 100개까지 → 나머지는 이어붙인다
  const page = await call('POST', '/pages', { parent: { database_id: dbId }, properties, children: blocks.slice(0, 100) });
  for (let i = 100; i < blocks.length; i += 100) {
    await call('PATCH', `/blocks/${page.id}/children`, { children: blocks.slice(i, i + 100) });
  }
  return page;
}

// 셋업에서 부모 페이지를 고르게 하기 위한 목록
export async function searchPages(call) {
  const r = await call('POST', '/search', {
    filter: { property: 'object', value: 'page' },
    page_size: 50,
  });
  return r.results.map((p) => ({
    id: p.id,
    title: Object.values(p.properties || {})
      .find((v) => v.type === 'title')?.title?.map((t) => t.plain_text).join('') || '(제목 없음)',
  }));
}

export async function searchDatabases(call) {
  const r = await call('POST', '/search', {
    filter: { property: 'object', value: 'database' },
    page_size: 50,
  });
  return r.results.map((d) => ({
    id: d.id,
    title: (d.title || []).map((t) => t.plain_text).join('') || '(제목 없음)',
  }));
}
