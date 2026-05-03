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


# Future ideas
* Eval of results so I can quantify & show improvements
* Admin UI
* LLM Rerank to improve quality of results
* Attribute weighted scoring to improve quality of results
* Filtering to improve performance
* Add multiple AI providers