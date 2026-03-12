// Extrai número de strings como "R$ 1.500", "1500", "2.000,00", "2k", "dois mil"
function parseSalary(text) {
  if (!text) return null
  const t = text.toLowerCase().trim()

  // "Xk" → X * 1000
  const kMatch = t.match(/(\d+(?:[.,]\d+)?)\s*k/)
  if (kMatch) return parseFloat(kMatch[1].replace(',', '.')) * 1000

  // Remove R$, espaços, pontos de milhar, converte vírgula decimal
  const cleaned = t
    .replace(/r\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '')
    .trim()

  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function scoreSalary(salaryRaw, ceiling) {
  const num = parseSalary(salaryRaw)
  if (!num) return 15 // desconhecido → neutro
  if (num <= ceiling)             return 30
  if (num <= ceiling * 1.2)       return 20
  if (num <= ceiling * 1.5)       return 10
  return 0
}

function scoreExperience(experienceRaw) {
  if (!experienceRaw) return 0
  const positive = ['sim', 'yes', 'true', '1']
  return positive.some(p => experienceRaw.toLowerCase().includes(p)) ? 25 : 0
}

function scoreResponseQuality(textAnswers) {
  // Exclui campos de contato, instagram, idade — considera só respostas substantivas
  const ignored = ['instagram', 'linkedin', 'idade', 'anos', 'estado civil', 'cidade', 'whatsapp', 'e-mail', 'email', 'nome', 'drive', 'vídeo', 'video']
  const substantive = textAnswers.filter(a => {
    const q = a.question.toLowerCase()
    return !ignored.some(k => q.includes(k)) && a.answer.length > 2
  })

  if (!substantive.length) return 0

  const avgWords = substantive.reduce((sum, a) => {
    return sum + a.answer.split(/\s+/).filter(Boolean).length
  }, 0) / substantive.length

  if (avgWords >= 30) return 25
  if (avgWords >= 15) return 18
  if (avgWords >= 8)  return 10
  return 5
}

function scoreVideo(videoUrl) {
  if (!videoUrl || !videoUrl.trim()) return 0
  const url = videoUrl.trim().toLowerCase()
  if (url.startsWith('http') || url.includes('drive.google') || url.includes('youtu') || url.includes('loom')) return 20
  return 5 // tem algo mas não parece link válido
}

function getDecision(score) {
  if (score >= 75) return { label: 'Agendar reunião', color: 'green' }
  if (score >= 50) return { label: 'Revisar',         color: 'yellow' }
  return           { label: 'Não prosseguir',          color: 'red' }
}

function scoreCandidate(candidate) {
  const salary     = scoreSalary(candidate.salary_raw, candidate.salary_ceiling)
  const experience = scoreExperience(candidate.experience_raw)
  const quality    = scoreResponseQuality(candidate.text_answers)
  const video      = scoreVideo(candidate.video_url)

  const total = salary + experience + quality + video

  return {
    ...candidate,
    score: total,
    score_breakdown: { salary, experience, quality, video },
    decision: getDecision(total),
  }
}

module.exports = { scoreCandidate, parseSalary }
