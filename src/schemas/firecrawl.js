/**
 * JSON Schemas for Firecrawl's structured extraction (formats: [{type: "json", schema: ...}])
 * These are passed directly to Firecrawl to extract structured SEO data from pages.
 *
 * IMPORTANT: Firecrawl JSON mode costs +4 credits per page on top of the base 1 credit.
 */

const SEO_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    meta_title:        { type: 'string', description: 'Content of <title> tag' },
    meta_description:  { type: 'string', description: 'Content of meta description tag' },
    meta_robots:       { type: 'string', description: 'Content of meta robots tag' },
    canonical_url:     { type: 'string', description: 'Canonical URL if present' },
    h1:                { type: 'array', items: { type: 'string' }, description: 'All H1 tags on page' },
    h2:                { type: 'array', items: { type: 'string' }, description: 'All H2 tags on page' },
    h3:                { type: 'array', items: { type: 'string' }, description: 'All H3 tags on page' },
    word_count:        { type: 'integer', description: 'Total word count of main content' },
    internal_links:    { type: 'integer', description: 'Count of internal links' },
    external_links:    { type: 'integer', description: 'Count of external links' },
    images_total:      { type: 'integer', description: 'Total image count' },
    images_missing_alt:{ type: 'integer', description: 'Images without alt text' },
    has_schema_org:    { type: 'boolean', description: 'Whether page has Schema.org/JSON-LD' },
    schema_types:      { type: 'array', items: { type: 'string' }, description: 'Schema.org types found' },
    has_og_tags:       { type: 'boolean', description: 'Whether Open Graph tags are present' },
    og_title:          { type: 'string' },
    og_description:    { type: 'string' },
    og_image:          { type: 'string' },
    has_twitter_cards:  { type: 'boolean', description: 'Whether Twitter Card tags present' },
    hreflang_tags:     { type: 'array', items: { type: 'string' }, description: 'hreflang values found' },
    language:          { type: 'string', description: 'Page language' }
  }
};

const PRICING_MONITOR_SCHEMA = {
  type: 'object',
  properties: {
    pricing_tiers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name:     { type: 'string' },
          price:    { type: 'string' },
          period:   { type: 'string' },
          features: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    has_free_tier:   { type: 'boolean' },
    has_free_trial:  { type: 'boolean' },
    enterprise_cta:  { type: 'string' },
    currency:        { type: 'string' }
  }
};

const CONTENT_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    title:              { type: 'string' },
    author:             { type: 'string' },
    publish_date:       { type: 'string' },
    last_updated:       { type: 'string' },
    word_count:         { type: 'integer' },
    reading_time_mins:  { type: 'integer' },
    primary_topic:      { type: 'string' },
    secondary_topics:   { type: 'array', items: { type: 'string' } },
    has_table_of_contents: { type: 'boolean' },
    has_faq_section:    { type: 'boolean' },
    has_statistics:     { type: 'boolean' },
    external_sources_cited: { type: 'integer' },
    cta_text:           { type: 'string' }
  }
};

module.exports = {
  SEO_AUDIT_SCHEMA,
  PRICING_MONITOR_SCHEMA,
  CONTENT_ANALYSIS_SCHEMA
};
