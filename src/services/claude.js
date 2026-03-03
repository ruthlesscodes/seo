// ============================================
// Claude AI Analysis Service
// Handles all AI-powered analysis:
// - Keyword clustering & prioritization
// - Content gap analysis
// - Blog post generation
// - Competitive intelligence
// ============================================

const Anthropic = require('@anthropic-ai/sdk');

class ClaudeAnalysisService {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    this.model = 'claude-sonnet-4-20250514';
  }

  // ============================================
  // WEEKLY SEO BRIEF
  // Analyze all scraped data into actionable brief
  // ============================================
  async generateWeeklyBrief({ keywordResults, competitorData, orgDomain, orgContext }) {
    const prompt = `You are an expert SEO strategist. Analyze this keyword and competitor data to produce a comprehensive weekly SEO action plan.

COMPANY CONTEXT:
Domain: ${orgDomain}
${orgContext || 'Fintech neobank targeting underserved markets.'}

KEYWORD ANALYSIS (${keywordResults.length} keywords searched):
${JSON.stringify(keywordResults.map(k => ({
  keyword: k.keyword,
  segment: k.segment,
  ourPosition: k.results?.find(r => r.domain.includes(orgDomain.replace('www.', '')))?.position || null,
  topCompetitors: k.results?.slice(0, 3).map(r => ({ domain: r.domain, position: r.position })) || [],
  resultCount: k.results?.length || 0
})), null, 2)}

COMPETITOR INTELLIGENCE:
${JSON.stringify(competitorData.map(c => ({
  domain: c.domain,
  pagesFound: c.totalPages,
  avgWordCount: c.avgWordCount,
  recentTopics: c.allTopics?.slice(0, 15) || []
})), null, 2)}

Produce a JSON response with this exact structure:
{
  "headline": "One-line strategic summary",
  "topOpportunities": [
    {
      "keyword": "the keyword",
      "segment": "segment name",
      "reason": "Why this is an opportunity",
      "suggestedTitle": "Blog post title",
      "estimatedDifficulty": "easy|medium|hard",
      "searchIntent": "informational|transactional|navigational",
      "priorityScore": 1-10
    }
  ],
  "contentCalendar": [
    {
      "week": 1,
      "title": "Blog post title",
      "targetKeyword": "primary keyword",
      "secondaryKeywords": ["related", "keywords"],
      "segment": "target segment",
      "outline": ["Section 1", "Section 2", "Section 3"],
      "wordCountTarget": 1500,
      "contentType": "guide|comparison|how-to|listicle|case-study"
    }
  ],
  "competitorMoves": [
    {
      "competitor": "domain",
      "observation": "What they're doing",
      "threat": "low|medium|high",
      "counterAction": "What we should do"
    }
  ],
  "quickWins": ["Immediate actionable items"],
  "contentGaps": [
    {
      "topic": "Topic area",
      "keywords": ["related keywords"],
      "competitorsCovering": ["domains covering this"],
      "urgency": "high|medium|low"
    }
  ],
  "technicalSEONotes": ["Any technical observations from the data"]
}

Respond ONLY with valid JSON. No markdown, no explanation.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0]?.text || '{}';
      const clean = text.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (error) {
      console.error('Claude analysis failed:', error.message);
      return {
        headline: 'Analysis failed - review data manually',
        error: error.message,
        topOpportunities: [],
        contentCalendar: [],
        competitorMoves: [],
        quickWins: ['Manual review needed'],
        contentGaps: []
      };
    }
  }

  // ============================================
  // BLOG POST GENERATION
  // Generate SEO-optimized blog post from brief
  // ============================================
  async generateBlogPost({ title, targetKeyword, secondaryKeywords, segment, outline, wordCountTarget, orgContext, competitorContent }) {
    const prompt = `Write a comprehensive, SEO-optimized blog post for a fintech company.

ARTICLE SPECS:
Title: ${title}
Primary Keyword: ${targetKeyword}
Secondary Keywords: ${(secondaryKeywords || []).join(', ')}
Target Segment: ${segment}
Target Word Count: ${wordCountTarget || 1500}
Content Outline: ${JSON.stringify(outline || [])}

COMPANY CONTEXT:
${orgContext || 'A fintech neobank that helps immigrants build credit in 6 months through a unique virtual card qualification system. Zero foreign exchange fees. Available at app.getplu.com.'}

COMPETITOR CONTENT (for reference - do NOT copy):
${competitorContent ? JSON.stringify(competitorContent.slice(0, 3).map(c => ({ title: c.title, headings: c.headings?.h2s?.slice(0, 5) }))) : 'No competitor content provided'}

SEO REQUIREMENTS:
1. Include "${targetKeyword}" in the H1 title, first paragraph, and at least 3 H2 headings naturally
2. Use secondary keywords naturally throughout
3. Write in a warm, authoritative, empathetic tone for the immigrant audience
4. Include specific statistics and data points where relevant
5. Add a clear CTA in the middle and end of the article
6. Include a FAQ section with 4-5 questions (optimized for featured snippets)
7. End with a brief conclusion and related reading suggestions
8. Use short paragraphs (2-3 sentences max)
9. Include transition phrases between sections

OUTPUT FORMAT:
Return clean Markdown with:
- H1 title
- Meta description (in a comment at the top)
- All H2 and H3 sections
- FAQ section with ## FAQ heading
- Internal link suggestions as [Link Text](https://getplu.com/relevant-page)

Write the complete article now.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = response.content[0]?.text || '';
      
      // Extract meta description if present
      const metaMatch = content.match(/<!--\s*meta[:\s]*(.*?)\s*-->/i);
      const metaDescription = metaMatch ? metaMatch[1] : '';

      return {
        success: true,
        content,
        wordCount: content.split(/\s+/).length,
        metaTitle: title,
        metaDescription,
        targetKeyword,
        segment,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Blog generation failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // KEYWORD CLUSTERING
  // Group keywords by intent and topic
  // ============================================
  async clusterKeywords(keywords) {
    const prompt = `Analyze these keywords and cluster them by search intent and topic relevance.

Keywords:
${keywords.map(k => `- "${k.keyword}" (segment: ${k.segment})`).join('\n')}

Return JSON:
{
  "clusters": [
    {
      "name": "Cluster Name",
      "intent": "informational|transactional|navigational|commercial",
      "keywords": ["keyword1", "keyword2"],
      "suggestedPageType": "blog|landing-page|comparison|tool",
      "pillarTopic": "The overarching topic"
    }
  ],
  "pillarPages": [
    {
      "topic": "Pillar topic name",
      "targetKeyword": "main keyword",
      "clusterKeywords": ["supporting keywords"],
      "suggestedTitle": "Page title"
    }
  ]
}

JSON only, no markdown.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0]?.text || '{}';
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (error) {
      console.error('Clustering failed:', error.message);
      return { clusters: [], pillarPages: [], error: error.message };
    }
  }

  // ============================================
  // CONTENT REFRESH RECOMMENDATIONS
  // Analyze declining pages and suggest updates
  // ============================================
  async suggestContentRefresh({ url, currentContent, keyword, positionChange, competitorContent }) {
    const prompt = `A page's ranking has changed for the keyword "${keyword}".

Current position change: ${positionChange > 0 ? `Dropped ${positionChange} positions` : `Improved ${Math.abs(positionChange)} positions`}

Our current content (first 1000 chars):
${(currentContent || '').substring(0, 1000)}

Top competitor content that outranks us (headings only):
${JSON.stringify(competitorContent?.map(c => ({ title: c.title, headings: c.headings?.h2s })).slice(0, 3) || [])}

Analyze and suggest specific updates. Return JSON:
{
  "urgency": "high|medium|low",
  "recommendations": [
    {
      "type": "add_section|update_section|add_faq|improve_intro|add_data|add_internal_links",
      "description": "What to do",
      "suggestedContent": "Brief content suggestion"
    }
  ],
  "missingTopics": ["Topics competitors cover that we don't"],
  "estimatedImpact": "Brief impact assessment"
}

JSON only.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0]?.text || '{}';
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (error) {
      return { urgency: 'medium', recommendations: [], error: error.message };
    }
  }
}

module.exports = { ClaudeAnalysisService };
