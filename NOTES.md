# NOTES
This document contains my play by play notes as I worked through the code challenge from first chair.

# 0. Project Understanding and Setup
**Time spent:** 30 minutes

Created the github repo, spent some time digging around notion and FirstChair's website to get acquainted with the challenge and the overarching product. My understanding:

## First Chair
Using First Chair, users take photos of their space, decorate it with AI, and get deals on the products that match their vibe. The general vibe I get is it's like a self-service boutique interior designer that anyone can use. Thinking about a general data flow for the end of the product, I imagine something along the lines of:

```
[Raw Photo]--- user talks to AI --->[Decorated Photo]--- product matching ---> [Deals returned]
```

## The challenge
The challenge seems to revolve around the second part of that data flow - from a photo to product matching. We have a database to start with - clearly that's a hard constraint, we shouldn't touch it. The main requirements seem to be:
* Public User uploads image and gets product results back
* Public User provides model provider API key at runtime, stored in memory only
* Optionally, Public User provides a natural-language prompt to narrow or adjust resutls
* Admin User can view and configure product matching functionality meta-parameters
* Public User cannot access Admin interface (inferred)

Acceptance criteria
* All requirements above satisfied
* Lightweight evaluation of search results available
* README containing
    * Clear instructions to run the system locally
    * Concise overview of the system    
        * Key design choices, considerations, tradeoffs
        * Focused on the retrieval ranking implementation
    * List of future enhancements I'd implement next
* CHANGELOG.md including
    * Main changes made through the development of the project
        * Concise reasons and motivations
        * Corresponding prompts and instructions given to the coding agent
        * Focus on the search functionality and it's implementation

Stretch goals
* Graceful edge case handling (API failures, urecognizeable images, no good matches)

Software design principles
* Keep it simple
* Don't repeat yourself
* Separation of concerns
* Clear abstractions
* Designed to scale

Stack
* React + TS frontend
* Node + TS backend

## Exploring the database
* Contains no images - only text information
    * Thinking of using Vision LLM to extract structured attributes + a description for the uploaded image, then using this to search the DB
    * This gets us a raw ranking list, but match quality probably won't be great
    * Could also do an LLM re-rank of the top "raw rank" results to improve match quality - I was thinking of how I might rank results & the first thought was using an LLM, but then I thought if I'm gonna do that as a review why not make it part of the retrieval & get the improvements directly
    * This approach also creates somewhat of an admin surface: # of top results returned by search, flag to turn rerank on vs. off, weight of dimensions on search, prompt templates, model choice
        * I'm thinking of keeping this simple fully in-memory, the temptation to create a small DB is high but I'll try to avoid this for simplicity if possible.
    * Indexes and fields: 
        * weighted index on title (2) + description (1)
            * This will be the foundation for search
        * compound index on category, type, price
            * This will likely be very handy to improve search quality
        * no vector search available, embeddings are not very likely here
            * Could do in-memory if needed, but not nudged towards with the challenge setup
        * 15 categories with fairly even item distribution within them
        * Categories have types (e.g., category sofa has types sectional, sleeper, ...)
        * No nulls
        * Product description suggests some more structure (style, material, type, color)
            * Could recover this with one-shot LLM extraction, or even regex
                * Maybe even regex, seems like they follow a pretty consistent pattern
* Lightweight eval
    * Thinking of doing a small test harness: small set of image, expected result, and measuring relevant stuff (recall, LLM-as-judge to see if it's relevant)
        * Also thinking of measuring cost per run and latency, these feel relevant in the context of this product

## Initial design concepts
Thinking of:
* Image + user text prompt
* Vision LLM extracts from photo: category, type, style, material, color, ~dimensions, description, price-band hint
* Text LLM takes user prompt + refines search terms above based on them
* Hard filter on category/type to narrow down results
* Do a text query on these results - get top K
* LLM rerank of top K results with the original image attached (increase quality)
* Admin tab exposes - candidate strategy, K, filter strictness, attribute weights, rerank model, prompt templates

