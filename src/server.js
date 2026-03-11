require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const express       = require('express')
const PizZip        = require('pizzip')
const Docxtemplater = require('docxtemplater')
const multer        = require('multer')
const Anthropic     = require('@anthropic-ai/sdk')
const { v4: uuidv4 }= require('uuid')
const path          = require('path')
const fs            = require('fs')
const { getClient } = require('./supabase')

const app    = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

app.use(express.json({ limit: '20mb' }))
app.use(express.static(path.join(__dirname, '../public')))

const TEMPLATES_DIR   = path.join(__dirname, '../templates/processed')
const SUBMISSIONS_DIR = path.join(__dirname, '../data/submissions')

// Cria pasta local apenas se não estiver no Vercel
if (process.env.VERCEL !== '1') {
  fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true })
}

const CAMPOS_OBRIGATORIOS = {
  gestor:   ['razao_social','cnpj','endereco','cep','representante','cpf','telefone','email',
              'modalidade','salario','salario_extenso','dia_pagamento','dia_pagamento_extenso',
              'dia_contrato','mes_contrato','ano_contrato'],
  lider:    ['razao_social','cnpj','endereco','cep','representante','cpf','telefone','email',
              'salario','salario_extenso','dia_pagamento','dia_pagamento_extenso',
              'dia_contrato','mes_contrato','ano_contrato'],
  vendedor: ['razao_social','cnpj','logradouro','numero','bairro','cidade','uf','cep',
              'representante','cpf','email','whatsapp','dia_contrato','mes_contrato','ano_contrato'],
  sdr:      ['razao_social','cnpj','logradouro','numero','bairro','cidade','uf','cep',
              'representante','cpf','email','whatsapp','chave_pix',
              'dia_contrato','mes_contrato','ano_contrato'],
}

// ─────────────────────────────────────────────
// POST /generate
// ─────────────────────────────────────────────
app.post('/generate', (req, res) => {
  const { tipo, ...fields } = req.body
  if (!tipo) return res.status(400).json({ error: 'Tipo de contrato não informado' })

  const templatePath = path.join(TEMPLATES_DIR, `${tipo}.docx`)
  if (!fs.existsSync(templatePath))
    return res.status(404).json({ error: `Template "${tipo}" não encontrado` })

  try {
    const content = fs.readFileSync(templatePath, 'binary')
    const zip     = new PizZip(content)
    const doc     = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
    doc.render(fields)
    const buffer = doc.getZip().generate({ type: 'nodebuffer' })
    const nome   = `contrato-${tipo}-${Date.now()}.docx`
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.send(buffer)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao processar template: ' + err.message })
  }
})

// ─────────────────────────────────────────────
// POST /extract — IA analisa print ClickUp
// ─────────────────────────────────────────────
app.post('/extract', upload.single('imagem'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' })

  const client    = new Anthropic({ apiKey })
  const base64    = req.file.buffer.toString('base64')
  const mediaType = req.file.mimetype || 'image/png'

  const prompt = `Você está analisando um print de tarefa do ClickUp com dados de uma pessoa a ser contratada.

Extraia TODOS os dados que encontrar e retorne SOMENTE um objeto JSON válido (sem markdown, sem explicações).

Campos possíveis:
- razao_social: nome da empresa ou pessoa jurídica
- cnpj: CNPJ no formato XX.XXX.XXX/0001-XX
- representante: nome completo do representante legal
- cpf: CPF no formato XXX.XXX.XXX-XX
- telefone: telefone com DDD
- email: endereço de e-mail
- whatsapp: número de WhatsApp com DDD
- logradouro: nome da rua ou avenida (sem número)
- numero: número do endereço
- bairro: bairro
- cidade: cidade
- uf: estado (sigla, ex: PR)
- cep: CEP no formato XX.XXX-XXX
- endereco: endereço completo (quando não separado em campos)
- modalidade: modalidade de trabalho (presencial, home office ou híbrido)
- salario: valor do salário, apenas números e vírgula, ex: 3.000,00
- salario_extenso: salário por extenso
- dia_pagamento: dia do mês para pagamento (apenas o número)
- dia_pagamento_extenso: dia do pagamento por extenso
- chave_pix: chave PIX
- tipo_contrato: tipo detectado (gestor, lider, vendedor ou sdr) — inferir pelo cargo mencionado

Retorne apenas os campos encontrados.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    })

    const text      = response.content[0].text.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(422).json({ error: 'Não foi possível extrair dados', raw: text })

    const dados   = JSON.parse(jsonMatch[0])
    const tipo    = dados.tipo_contrato
    const faltando = tipo
      ? (CAMPOS_OBRIGATORIOS[tipo] || []).filter(c => !dados[c] || dados[c] === '')
      : []

    res.json({ dados, faltando })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro na análise: ' + err.message })
  }
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
// POST /tunnel — cria link público (localtunnel)
// ─────────────────────────────────────────────
let activeTunnel = null

app.post('/tunnel', async (req, res) => {
  const { tipo } = req.body
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
app.listen(PORT, () => {
  console.log(`✅ Gerador de contratos rodando em http://localhost:${PORT}`)
})

module.exports = app
