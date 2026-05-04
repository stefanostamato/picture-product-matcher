# NOTES
This document contains my play by play notes as I worked through the code challenge from first chair.

# 0. Project Understanding and Setup
**Time spent:** 30 minutes
**Agent prompts used:**
```
I'm working on a coding challenge from this public notion doc: https://first-chair.notion.site/AI-full-stack-programming-task-Image-Based-Product-Search-302c7d29276f80c395e6f97ebe7f9044

Read the challenge and understand it thorouhgly. The role advertised is for senior AI engineer, so I think we should weigh it heavier on the AI side than the UX/UI and full stack side. What are your thoughts?
```
```
Please explore the db and tell me what you find - fields, indexes, anything we can use to solve this challenge
```

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

# 1. AI tooling setup
**Time spent:** 25 minutes
**Prompts used:**
```
Read @NOTES.md and become acquainted with this project.

Please crerate an AGENTS.md with architecture, software development principles, and any other non-functional requirements we have to build this project. It's important that the code structure be clear, organized, and easy to read. Other important principles are listed in NOTES.md.

Please create three slash commands to help me:
* `/plan` - as a senior architect and engineer, grill me about a feature, and write a plan with right-sized tasks and clear dependencies to be executed by parallel subagents. The plan should include an overal feature spec, all the tasks, a task dependency graph, and a parallel execution strategy. Each task should contain a prompt to be fed to subagents including entrypoints, instructions on what they need to build, and TDD instructions.
* `/execute` - orchestrate subagents to execute the plan, and once all are done check to make sure the plan was actually completed
* `/push-change` - propose a commit structure, commit, push, write to CHANGELOG.md
```

I'm going to keep it simple here, three simple commands
* `/plan` - grill me about a feature, and write a plan with right-sized tasks and clear dependencies to be executed by parallel subagents
* `/execute` - orchestrate subagents to execute the plan
* `/push-change` - propose a commit structure, commit, push, write to CHANGELOG.md

And a simple `AGENTS.md` file to capture the sprit/rules of how code should be written for this project. I had to refine the AGENTS.md file to include a repo layout and use docker compose up as the canonical run command, and also created a tiny README.md to start documenting the run instructions.

# 2. Initial project setup (initial-e2e)
**time spent:** 60 minutes

Now it's time to start leveraging the AI tools we just setup. I gave AI these prompts:
```
I want to build an initial end-to-end version of this project. Read @NOTES.md for what we're trying to build. Can you tell me what you'd propose?
```
After some discussion we landed on a general direction:
* Thinnest vertical pipeline (no rerank, no admin UI, no eval harness, no attribute weighted scoring, fancy filters)
* Plumb a config object throuhg the backend for stuff we'll want to config later, so that we're not shooting ourselves in the foot here

I then told the agent to `/plan` this and worked through the questions until we were ready to write the plan. Then I told the agent to `/execute` it.

After the execute stage, I manually tested it with docker compose up and uploading a test image. Ran into some errors (CORS, node_modules volume mapping, lack of error logging in the backend). Worked with claude to fix these as I found them. In real projects I typically like to invest more in e2e test tooling to help agents find and fix errors themselves, but I decided not to prioritize that for this project given the time pressure.

The /search endpoint started working quickly but it wasn't returning any results. I debugged it and found that the cateogry being returned by the LLM search was not an identical match to the DB categories - I replaced the freeform category it returns by an Enum pulled from the real DB.

I then decided to /push-change this. I tweaked CHANGELOG a little bit and then pushed.

# 3. Eval harness
**time spent:** 60 minutes

I started planning this during the implementation of the initial-e2e plan (~40 minutes after it had started). I'm thinking about how to build an evaluation harness - something lightweight that lets me judge how good the results from the search are. I first did this in an exploratory way with the following prompt:

```
I'm thinking of building a lightweight evaluation harness to help me gauge the quality of the search results returned. I have another agent running with the execution of @plans/initial-e2e.md - this will be executed after that is completed.

Can you read @NOTES.md and propose a lightweight eval harness we could add here? I'm thinking:
* Something that prints out eval results with every query ran - this should be easy for me to use during development, and for a reviewer to examine when testing out my submission.
* Something that captures relevant metrics - recall, latency, cost (tokens and dollars)
* Something that captures metrics based on different categories (i.e., matching the right category, type, stuff inferred from the description like colour, style, material, etc) so that the eval is useful to pinpoint where we're performing well and where further tuning is needed
* Probably a lightweight "gold standard" eval set - maybe work backwards from real DB descriptions and use AI to generate images of stuff that matches categories, descriptions, etc.
* Ideally we also generate a few manual testing items - these aren't used by eval but rather by me during manual testing, so that we can inspect for generalizability
* Maybe even a lightweight history.json that tells us how model performance has evolved over time? This could be useful to show in the admin interface potentially, not sure - what are your thoughts?

I want you to inspect the problem space, think about it criticaly, suggest metrics that would be relevant to capture, and suggest a lightweight eval harness that can accomplish these things. Simplicity is key, but it should be built with scale in mind - not just more data, but as the project grows and if we were to make adjustments to the search pipeline, etc.
```

I landed on an approach like this:
* per-query diagnostic panel, gated on running the project with `npm run dev` (dev-only)
    * Gives devs visibility over what's happening behind the scenes, helpful for fine tuning later
    * Potentially not something we'd want to expose in prod, so I decided to gate it
* Eval harness with `npm run dev`
    * 30-item gold standard dataset (AI generated with a different model from the one used for search, to reduce bias)
    * Runs each item through the pipeline, scores it, prints a per-category breakdown to stdout, appends to a history file so I can track progress
* Metrics
    * recall (@1/5/20), MRR, categoryHit, typeHit, attributeOverlap (Jaccard), p50/p95 latency per stage, total tokens, total $, failure-mode counts
    * reported overall as well as broken down by category

A couple key decisions to highlight:
* Splitting dev diag panel from actual eval - eval needs a gold set, dev diag needs to run on each actual request (no gold standard to compare against). They serve different purposes, but are both helpful for iterating on the pipeline.
* Implemented pricing capturing in providers, not eval - because I wanted to see the pricing on the dev diag panel and evals, it didn't make sense for this to be owned by another layer. Also different providers may implement pricing info in a different way, so this also nudged me to implement this at this layer.
* AI generated gold set - in reality I'd spend a lot more time fine tuning this by hand, but given the time pressure I decided to leverage AI heavily here. I picked my test items from the DB (see note below) and generated AI images based on those descriptions. Theoretically running the pipeline based on those images should retrieve those items.
* Different models for gold set generation and pipeline - gpt-image-1 was used to generate these images, gpt-4o-mini was used to extract attributes from the DB description. The pipeline itself uses gpt-4o-mini - I wanted to use a different model for the image generation to minimize circularity somewhat. This was the simplest, quickest approach I landed on for this test. It won't fully solve it, so I'm also hand-picking 10 images from the internet to manually test with real data.
* Test item selection from DB - I explicitly chose to get 2 different types per category, rather than go for random. Did this to cover more of the search space while keeping the eval lightweight.
* No precision/F1/NDCG scores - The eval has one true positive per query, so these metrics would add more noise than value at this stage. Decided to skip them. 
* Creating a lightweight history - Added a jsonl file as an append-only history of eval runs with a snapshot of the config + git sha per row. The pipeline config will be mutable at runtime eventually, so capturing it in the history was important to make rows comparable long-term. Git SHA per row pins the code, plus goldSetVersion pins the fixtures so that we can safely extend the gold standard set later without making prior history useless. This will also be handy for the admin UI later.
* Eval runner consumes the `runPipeline` directly - it's just another caller, so that we're testing exactly what we use in production. This also lets us evolve the pipeline cleanly without having to touch eval.

The first eval results:
```
=== Eval results (overall) ===
n              30
recall@1       0.033
recall@5       0.367
recall@20      0.600
mrr            0.179
category-hit   0.933
type-hit       0.333
attr-overlap   0.142
p50 latency    3285 ms
p95 latency    19834 ms
tokens (total) 776555
cost           $0.11736
failures       missing=12 categoryMiss=2 typeMiss=20

=== By category ===
category        n   r@1    r@5    r@20   mrr    attr   $         
Beds            2   0.000  0.000  0.500  0.050  0.000  $0.00783  
Benches         2   0.000  0.000  1.000  0.104  0.000  $0.00783  
Bookshelves     2   0.000  1.000  1.000  0.225  0.100  $0.00783  
Cabinets        2   0.000  0.000  0.500  0.063  0.100  $0.00783  
Chairs          2   0.000  0.000  0.500  0.083  0.000  $0.00783  
Coffee Tables   2   0.000  0.000  0.000  0.000  0.000  $0.00782  
Desks           2   0.000  0.000  0.000  0.000  0.250  $0.00782  
Dressers        2   0.000  0.000  0.000  0.000  0.000  $0.00782  
Lighting        2   0.000  1.000  1.000  0.417  0.250  $0.00782  
Nightstands     2   0.000  0.500  1.000  0.222  0.200  $0.00782  
Ottomans        2   0.000  0.500  0.500  0.125  0.350  $0.00782  
Sofas           2   0.500  1.000  1.000  0.600  0.333  $0.00781  
TV Stands       2   0.000  0.500  0.500  0.250  0.350  $0.00782  
Tables          2   0.000  0.500  1.000  0.292  0.100  $0.00783  
Wardrobes       2   0.000  0.500  0.500  0.250  0.100  $0.00782  

```
* This tells me we're hitting the right category but matching the wrong type
* This also points to the LLM rerank as potentially very impactful - I'm gonna keep prioritizing that given time crunch & plans already built. But there are lower hanging fruit I'd consider.
    * We're getting the right result in the top 20 frequently, but we rarely pick it as the top result - I'm hoping LLM rerank will help with this.
* Another thing I'm not doing but maybe should is to treat type as an ENUM (similar to what I'm doing for categories - works well there, maybe would help here)

# 4. README refactor
As time was coming to a close, I decided to refactor the README to match the challenge instructions.

# 5. Admin UI + LLM rerank
**Full disclosure:** I completed this part after the 4 hour limit. The eval test set generation took a lot longer than anticipated, and I was already halfay done. I decided to keep pushing as the eval allowed me to have deep insights that would be very helpful, but in hindsight I would have tried to simplify this a lot more.

Started planning this while the eval harness was being built. I used this prompt to get started:
```
I have a separate agent building @plans/eval-harness.md 

I now want to start thinking about the Admin UI. Can you read @NOTES.md to analyze the problem, requirements, think critically about them, and suggest what we should build?
```

While the AI was running, I referred back to the challenge in Notion to think independently about what this needs. I noted down:
* internal, back-office interface (not public) - needs simple gating
* needs to allow configuring the product matching functionality

From my own thinking I also want:
* An overview of the search pipeline, so admins understand at a glance how it works and what knobs might do
* Rendering of history.jsonl

I then decided to /plan this feature.

Tradeoffs/decisions:
* Simple admin password: instead of implementing full on auth, I decided to keep it super simple. .env defines `ADMIN_PASSWORD`. Frontend keeps the password in sessionStorage, sends x-admin-password as a header on every admin call. Backend middleware compares it to .env. Very rudimentary, I would never do this for an actual product. But I made a judgement call to focus more on the retrieval piece than hardening for this challenge, especially considering the time pressure. It still felt important to me to add some form of protection to the admin stuff as it was specifically mentioned this was a non-public interface.

Because the test dataset for the eval harness was taking a while to reload, I decided to add to the scope of this iteration the addition of an LLM rerank step to improve the quality of search results. The idea is that we get results back, and instead of showing them to the user directly, we first show it to an LLM who's responsible for recalibrating the results so that they're more relevant. Some tradeoffs I considered:
* Higher cost - I decided to build this anyway even if it does add more cost to each run, because it's an admin-gated change. Admins can always disable if I realize it's bad or costing too much.
* Latency - this will add another couple seconds to the search time. It's not ideal, and there would be other refinements that don't add this (e.g., running a jaccard similarity locally on the attributes and reranking based on that). In this case I decided to prioritize quality over latency - my gut says this whole project is about image -> text results so doing the refinement based on the image directly feels like the most promising path to increase quality.
* Should the rerank remove results or just shuffle them around? I decided just shuffle (re-order) them for now. Didn't want to remove search results as I feel sometimes people shopping around like to see more options. I think there's a balance here (thinking of UX principles where choice creats doubt which reduces action) but I decided to air on the side of more for the time being.

After building this, I manually tested a few things:
* manually tested the retrieval
* manually tested the admin and adjusting knobs
* all seems to be working pretty well!

I decided to push these changes.

# Future ideas
* Attribute weighted scoring to improve quality of results
* Filtering to improve performance
* Add multiple AI providers