const TYPEFORM_API = 'https://api.typeform.com'
const TOKEN = process.env.TYPEFORM_TOKEN

// Apenas formulários ativos para triagem
const FORM_CONFIG = {
  ZQPMxCEn: {
    title:            'Gestor de Tráfego',
    salary_ceiling:   1700,
    salary_field:     'kI5wawu1NBu6',
    experience_field: 'FyA88KT7hfEY',
    video_field:      'J0Eavq0Rgou2',
  },
  nBEOq4tP: {
    title:            'Closer',
    salary_ceiling:   5000,
    salary_field:     '3NLjJR2omG2R',
    experience_field: 'TXDQhsi20TMh',
    video_field:      null,
  },
}

// Filtro de data: janeiro 2025 até hoje (cobre todo histórico relevante)
const DATE_SINCE = '2025-01-01T00:00:00Z'

async function tfFetch(path) {
  const res = await fetch(`${TYPEFORM_API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`Typeform API error ${res.status}: ${path}`)
  return res.json()
}

function extractText(answer) {
  if (!answer) return ''
  return answer.text || answer.choice?.label || answer.choices?.labels?.join(', ') || ''
}

function extractName(answers, fields) {
  // Tenta contact_info primeiro
  const contactAnswer = answers.find(a => {
    const field = fields.find(f => f.id === a.field.id)
    return field?.type === 'contact_info'
  })
  if (contactAnswer) {
    const first = contactAnswer.fields?.find(f => f.type === 'first_name')?.text || ''
    const last  = contactAnswer.fields?.find(f => f.type === 'last_name')?.text  || ''
    if (first || last) return `${first} ${last}`.trim()
  }

  // Tenta campo "Nome" explícito
  const nameField = fields.find(f =>
    f.title?.toLowerCase().includes('nome') && (f.type === 'short_text' || f.type === 'long_text')
  )
  if (nameField) {
    const ans = answers.find(a => a.field.id === nameField.id)
    if (ans) return extractText(ans)
  }

  // Fallback: primeiros dois campos de texto (first name / last name split)
  const textAnswers = answers
    .filter(a => a.type === 'text')
    .slice(0, 2)
    .map(a => extractText(a))
    .filter(Boolean)
  return textAnswers.join(' ').trim() || 'Sem nome'
}

function extractContact(answers, fields) {
  const contact = { email: '', phone: '' }

  // contact_info block
  const cAns = answers.find(a => {
    const f = fields.find(f => f.id === a.field.id)
    return f?.type === 'contact_info'
  })
  if (cAns) {
    contact.email = cAns.fields?.find(f => f.type === 'email')?.text || ''
    contact.phone = cAns.fields?.find(f => f.type === 'phone_number')?.text || ''
  }

  // Campos explícitos
  for (const ans of answers) {
    if (ans.type === 'email')        contact.email = ans.email        || contact.email
    if (ans.type === 'phone_number') contact.phone = ans.phone_number || contact.phone
  }

  // long_text com "e-mail"
  if (!contact.email) {
    const emailField = fields.find(f => f.title?.toLowerCase().includes('e-mail') || f.title?.toLowerCase().includes('email'))
    if (emailField) {
      const ans = answers.find(a => a.field.id === emailField.id)
      if (ans) contact.email = extractText(ans)
    }
  }

  return contact
}

async function getFormResponses(formId, pageSize = 200) {
  const config = FORM_CONFIG[formId]
  if (!config) throw new Error(`Form ${formId} não configurado`)

  const [formDef, responsesData] = await Promise.all([
    tfFetch(`/forms/${formId}`),
    tfFetch(`/forms/${formId}/responses?page_size=${pageSize}&sort_by=submitted_at&order=desc&since=${DATE_SINCE}`),
  ])

  const fields = formDef.fields || []

  return responsesData.items.map(item => {
    const answers = item.answers || []

    const getFieldAnswer = fieldId => {
      if (!fieldId) return null
      return answers.find(a => a.field.id === fieldId) || null
    }

    const salaryAns   = getFieldAnswer(config.salary_field)
    const expAns      = getFieldAnswer(config.experience_field)
    const videoAns    = getFieldAnswer(config.video_field)

    const textAnswers = answers
      .filter(a => a.type === 'text' || a.type === 'long_text' || a.type === 'short_text')
      .map(a => ({
        question: fields.find(f => f.id === a.field.id)?.title || a.field.id,
        answer: extractText(a),
      }))

    return {
      response_id:    item.response_id,
      submitted_at:   item.submitted_at,
      form_id:        formId,
      form_title:     config.title,
      name:           extractName(answers, fields),
      contact:        extractContact(answers, fields),
      salary_raw:     extractText(salaryAns),
      experience_raw: expAns ? (expAns.choice?.label || expAns.choices?.labels?.join(', ') || '') : '',
      video_url:      extractText(videoAns),
      text_answers:   textAnswers,
      salary_ceiling: config.salary_ceiling,
    }
  })
}

async function listHiringForms() {
  return Object.entries(FORM_CONFIG).map(([id, cfg]) => ({ id, ...cfg }))
}

module.exports = { getFormResponses, listHiringForms, FORM_CONFIG }
