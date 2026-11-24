# Rain 3D textures

`asphalt.jpg` and `asphalt_nor.jpg` come from **Asphalt Floor** by eye-candy.xyz on Poly Haven
(https://polyhaven.com/a/asphalt_floor), licensed CC0. They are the 1k JPG maps and tile every 2.35 m.

- `asphalt.jpg` packs three maps into one file: R = diffuse (as greyscale), G = roughness, B = displacement (height).
- `asphalt_nor.jpg` is the OpenGL normal map (`nor_gl`).

They are used by `wetGroundMaterial` and `wetLines` in js/render3d.js.

`post_rust.jpg` is **Rusty Metal 04** from Poly Haven (https://polyhaven.com/a/rusty_metal_04), licensed CC0. It is the diffuse map, cut down to 512 px, and is used on the net posts (`buildMetalPosts`).
