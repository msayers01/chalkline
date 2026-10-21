-- Chalkline compile confinement, loaded with `lualatex --lua=confine.lua`.
--
-- kpathsea's openin_any=p does not stop LuaTeX from reading absolute paths,
-- so without the bubblewrap sandbox (local development, and every compile on
-- Windows) a document could \input or \includegraphics any file on disk.
-- This script runs before the format loads and refuses, through LuaTeX's file
-- callbacks, every file a document asks to read (\input, \openin, images)
-- unless it resolves inside the job directory or one of the TeX trees.
--
-- It does not confine Lua code itself: \directlua is banned by the sanitizer,
-- and in production bubblewrap hides the rest of the file system anyway.

local windows = os.type == "windows"

-- With --lua, LuaTeX does not install its shell-escape restrictions on Lua's
-- process functions: io.popen would run commands whatever -no-shell-escape
-- says. Turn every way of starting a process off, as shell_escape=f does.
local function no_shell()
  return nil, "shell escape is disabled"
end
os.execute = no_shell
io.popen = no_shell
os.exec = no_shell
os.spawn = no_shell
if os.kpsepopen then os.kpsepopen = no_shell end

-- With --lua the engine sets kpathsea up only when asked to, after this
-- script has run; the TeX trees are looked up on first use.
texconfig.kpse_init = true

local function normalize(path)
  path = path:gsub("\\", "/"):gsub("/+", "/")
  if windows then path = path:lower() end
  return path
end

local function is_absolute(path)
  return path:sub(1, 1) == "/" or path:match("^%a:/") ~= nil
end

local function has_parent_step(path)
  return ("/" .. path .. "/"):find("/%.%./") ~= nil
end

local job = normalize(lfs.currentdir()):gsub("/$", "")
local roots
local function roots_of()
  if roots then return roots end
  roots = { job }
  for tree in kpse.expand_path("$TEXMF"):gmatch(windows and "[^;]+" or "[^:]+") do
    if tree ~= "" and tree ~= "." then
      roots[#roots + 1] = normalize(tree):gsub("/$", "")
    end
  end
  return roots
end

local function allowed(path)
  local p = normalize(path)
  if has_parent_step(p) then return false end
  -- Relative paths (main.tex, assets/x.png, ./main.aux) are inside the job.
  if not is_absolute(p) then return true end
  for _, root in ipairs(roots_of()) do
    if p == root or p:sub(1, #root + 1) == root .. "/" then return true end
  end
  return false
end

local function refuse(asked)
  texio.write_nl("log", "chalkline: refused to read a file outside the job: " .. asked)
  return nil
end

local function find(asked)
  local found = kpse.find_file(asked, "tex", true)
  if not found and lfs.isfile(asked) then found = asked end
  if not found then return nil end
  if not allowed(asked) or not allowed(found) then return refuse(asked) end
  return found
end

-- \input (id 0) and \openin streams.
callback.register("find_read_file", function(_, asked)
  return find(asked)
end)

-- \includegraphics and other images.
callback.register("find_image_file", find)
