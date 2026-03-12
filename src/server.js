require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const express                       = require('express')
const PizZip                        = require('pizzip')
const Docxtemplater                 = require('docxtemplater')
const multer                        = require('multer')
const { randomUUID: uuidv4 }        = require('crypto')
const path                          = require('path')
const fs                            = require('fs')
const { getClient }                 = require('./supabase')
const { getFormResponses, listHiringForms } = require('./typeform')
const { scoreCandidate }            = require('./scorer')
const { analyzeCandidate }          = require('./analyzer')

const app    = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

app.use(express.json({ limit: '20mb' }))
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store')
    }
  }
}))

const TEMPLATES_DIR   = path.join(__dirname, '../templates/processed')
const SUBMISSIONS_DIR = path.join(__dirname, '../data/submissions')

// Cria pasta local apenas se não estiver no Vercel
if (process.env.VERCEL !== '1') {
  fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true })
}

const CAMPOS_OBRIGATORIOS = {
  gestor:   ['razao_social','cnpj','endereco','cep','representante','cpf','telefone','email',
              'modalidade','salario','salario_extenso','dia_pagamento','dia_pagamento_extenso',
              'chave_pix','dia_contrato','mes_contrato','ano_contrato'],
  lider:    ['razao_social','cnpj','endereco','cep','representante','cpf','telefone','email',
              'salario','salario_extenso','dia_pagamento','dia_pagamento_extenso',
              'chave_pix','dia_contrato','mes_contrato','ano_contrato'],
  vendedor: ['razao_social','cnpj','logradouro','numero','bairro','cidade','uf','cep',
              'representante','cpf','email','whatsapp','chave_pix',
              'dia_pagamento','dia_pagamento_extenso','dia_contrato','mes_contrato','ano_contrato'],
  sdr:      ['razao_social','cnpj','logradouro','numero','bairro','cidade','uf','cep',
              'representante','cpf','email','whatsapp','chave_pix',
              'dia_pagamento','dia_pagamento_extenso','dia_contrato','mes_contrato','ano_contrato'],
}

const MESES = ['janeiro','fevereiro','março','abril','maio','junho',
               'julho','agosto','setembro','outubro','novembro','dezembro']

// ─────────────────────────────────────────────
// GET /cnpj/:numero — busca razão social na Receita
// ─────────────────────────────────────────────
app.get('/cnpj/:numero', async (req, res) => {
  const cnpj = req.params.numero.replace(/\D/g, '')
  if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' })
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gerador-contratos/1.0)' }
    })
    if (!response.ok) return res.status(404).json({ error: 'CNPJ não encontrado' })
    const data = await response.json()
    res.json({
      razao_social: data.razao_social || data.nome_fantasia || '',
      nome_fantasia: data.nome_fantasia || '',
      logradouro: data.logradouro || '',
      numero: data.numero || '',
      bairro: data.bairro || '',
      municipio: data.municipio || '',
      uf: data.uf || '',
      cep: (data.cep || '').replace(/^(\d{5})(\d{3})$/, '$1-$2'),
    })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao consultar CNPJ: ' + err.message })
  }
})

// ─────────────────────────────────────────────
// POST /generate
// ─────────────────────────────────────────────
app.post('/generate', (req, res) => {
  const { tipo, ...fields } = req.body
  if (!tipo) return res.status(400).json({ error: 'Tipo de contrato não informado' })

  const templatePath = path.join(TEMPLATES_DIR, `${tipo}.docx`)
  if (!fs.existsSync(templatePath))
    return res.status(404).json({ error: `Template "${tipo}" não encontrado` })

  // Nome do cargo por tipo
  const NOMES_CARGO = {
    gestor:   'Gestor de Tráfego Pago',
    lider:    'Líder Técnico da Equipe Operacional',
    vendedor: 'Representante de Vendas (Closer)',
    sdr:      'SDR',
  }
  if (!fields.nome_cargo) fields.nome_cargo = NOMES_CARGO[tipo] || tipo

  // Chave PIX obrigatória em todos os contratos
  if (!fields.chave_pix || !fields.chave_pix.trim())
    return res.status(400).json({ error: 'Chave PIX é obrigatória' })

  // Data de criação automática
  const hoje = new Date()
  if (!fields.dia_contrato)  fields.dia_contrato  = String(hoje.getDate())
  if (!fields.mes_contrato)  fields.mes_contrato  = MESES[hoje.getMonth()]
  if (!fields.ano_contrato)  fields.ano_contrato  = String(hoje.getFullYear())

  try {
    const content = fs.readFileSync(templatePath, 'binary')
    const zip     = new PizZip(content)
    const doc     = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' })
    doc.render(fields)
    const buffer = doc.getZip().generate({ type: 'nodebuffer' })
    const TIPOS_NOME = { gestor: 'Gestor de Tráfego Pago', lider: 'Líder Técnico', vendedor: 'Vendedor', sdr: 'SDR' }
    const tipoNome   = TIPOS_NOME[tipo] || tipo
    const colaborador = (fields.representante || fields.razao_social || '').replace(/[/\\?%*:|"<>]/g, '-').trim()
    const nome   = colaborador ? `${tipoNome} - ${colaborador}.docx` : `contrato-${tipo}-${Date.now()}.docx`
    const nomeAscii = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(nome)}`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.send(buffer)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao processar template: ' + err.message })
  }
})



// ─────────────────────────────────────────────
// GET /triagem — página de triagem
// ─────────────────────────────────────────────
app.get('/triagem', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/triagem.html'))
})

// ─────────────────────────────────────────────
// GET /triagem/forms — lista formulários configurados
// ─────────────────────────────────────────────
app.get('/triagem/forms', async (_req, res) => {
  try {
    const forms = await listHiringForms()
    res.json(forms)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────
// GET /triagem/candidates/:formId — candidatos com score
// ─────────────────────────────────────────────
app.get('/triagem/candidates/:formId', async (req, res) => {
  if (!process.env.TYPEFORM_TOKEN)
    return res.status(500).json({ error: 'TYPEFORM_TOKEN não configurado' })

  try {
    const raw       = await getFormResponses(req.params.formId)
    const scored    = raw.map(scoreCandidate)
    scored.sort((a, b) => b.score - a.score)

    // Salva/atualiza no Supabase se disponível
    const sb = getClient()
    if (sb) {
      const rows = scored.map(c => ({
        id:             c.response_id,
        form_id:        c.form_id,
        form_title:     c.form_title,
        name:           c.name,
        email:          c.contact.email,
        phone:          c.contact.phone,
        score:          c.score,
        score_breakdown: c.score_breakdown,
        decision:       c.decision.label,
        salary_raw:     c.salary_raw,
        video_url:      c.video_url,
        text_answers:   c.text_answers,
        submitted_at:   c.submitted_at,
        status:         'pendente',
      }))
      await sb.from('candidates').upsert(rows, { onConflict: 'id' })
    }

    res.json(scored)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────
// POST /triagem/candidate/:id/analyze — análise com IA
// ─────────────────────────────────────────────
app.post('/triagem/candidate/:id/analyze', async (req, res) => {
  const { candidate } = req.body
  if (!candidate) return res.status(400).json({ error: 'Dados do candidato não enviados' })

  try {
    const analysis = await analyzeCandidate(candidate)

    // Salva no Supabase se disponível
    const sb = getClient()
    if (sb) {
      await sb.from('candidates').upsert(
        { id: req.params.id, ai_analysis: analysis },
        { onConflict: 'id' }
      )
    }

    res.json(analysis)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────────
// PATCH /triagem/candidate/:id/status — atualiza decisão manual
// ─────────────────────────────────────────────
app.patch('/triagem/candidate/:id/status', async (req, res) => {
  const { status } = req.body
  const allowed = ['Agendar reunião', 'Revisar', 'Não prosseguir']
  if (!allowed.includes(status))
    return res.status(400).json({ error: 'Status inválido' })

  const sb = getClient()
  if (sb) {
    const { error } = await sb.from('candidates').update({ decision: status }).eq('id', req.params.id)
    if (error) return res.status(500).json({ error: error.message })
  }
  res.json({ ok: true })
})

// ─────────────────────────────────────────────
// GET /fill/:tipo — formulário externo
// ─────────────────────────────────────────────
app.get('/fill/:tipo', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/fill.html'))
})

// ─────────────────────────────────────────────
// POST /submit — salva submissão (Supabase ou arquivo)
// ─────────────────────────────────────────────
app.post('/submit', async (req, res) => {
  const { tipo, ...fields } = req.body
  if (!tipo) return res.status(400).json({ error: 'Tipo não informado' })

  const id         = uuidv4()
  const submission = { id, tipo, fields, criado_em: new Date().toISOString(), status: 'pendente' }

  const sb = getClient()
  if (sb) {
    const { error } = await sb.from('submissions').insert(submission)
    if (error) return res.status(500).json({ error: error.message })
  } else {
    // fallback: arquivo local (dev)
    fs.writeFileSync(path.join(SUBMISSIONS_DIR, `${id}.json`), JSON.stringify(submission, null, 2))
  }

  res.json({ ok: true, id })
})

// ─────────────────────────────────────────────
// GET /submissions
// ─────────────────────────────────────────────
app.get('/submissions', async (_req, res) => {
  const sb = getClient()
  if (sb) {
    const { data, error } = await sb
      .from('submissions')
      .select('*')
      .order('criado_em', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }
  // fallback local
  const files = fs.existsSync(SUBMISSIONS_DIR)
    ? fs.readdirSync(SUBMISSIONS_DIR).filter(f => f.endsWith('.json'))
    : []
  const list = files.map(f => JSON.parse(fs.readFileSync(path.join(SUBMISSIONS_DIR, f), 'utf-8')))
  res.json(list.sort((a, b) => new Date(b.criado_em || b.criadoEm) - new Date(a.criado_em || a.criadoEm)))
})

// ─────────────────────────────────────────────
// GET /submission/:id
// ─────────────────────────────────────────────
app.get('/submission/:id', async (req, res) => {
  const sb = getClient()
  if (sb) {
    const { data, error } = await sb.from('submissions').select('*').eq('id', req.params.id).single()
    if (error || !data) return res.status(404).json({ error: 'Não encontrada' })
    return res.json(data)
  }
  const filePath = path.join(SUBMISSIONS_DIR, `${req.params.id}.json`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Não encontrada' })
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
})

// ─────────────────────────────────────────────
// POST /tunnel — cria link público
// Prioridade: VERCEL_URL > BASE_URL > localtunnel
// ─────────────────────────────────────────────
let activeTunnel = null

app.post('/tunnel', async (req, res) => {
  const { tipo } = req.body

  // 1. Vercel: usa a URL pública automática
  if (process.env.VERCEL_URL) {
    const base = `https://${process.env.VERCEL_URL}`
    return res.json({ url: `${base}/fill/${tipo || ''}`, base })
  }

  // 2. URL base personalizada (ex: ngrok configurado manualmente)
  if (process.env.BASE_URL) {
    const base = process.env.BASE_URL.replace(/\/$/, '')
    return res.json({ url: `${base}/fill/${tipo || ''}`, base })
  }

  // 3. Dev local: usa localtunnel
  try {
    if (activeTunnel) { activeTunnel.close(); activeTunnel = null }
    const localtunnel = require('localtunnel')
    const tunnel      = await localtunnel({ port: PORT })
    activeTunnel      = tunnel
    tunnel.on('close', () => { activeTunnel = null })
    res.json({ url: `${tunnel.url}/fill/${tipo || ''}`, base: tunnel.url })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar tunnel: ' + err.message })
  }
})

const PORT = process.env.PORT || 3000

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅ Gerador de contratos rodando em http://localhost:${PORT}`)
  })
}

module.exports = app
