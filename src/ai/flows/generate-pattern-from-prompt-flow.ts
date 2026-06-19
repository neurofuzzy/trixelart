'use server';
/**
 * @fileOverview A Genkit flow to generate a 3-fold rotationally symmetrical grid pattern based on a text prompt.
 *
 * - generatePatternFromPrompt - A function that generates a grid pattern.
 * - GeneratePatternFromPromptInput - The input type for the generatePatternFromPrompt function.
 * - GeneratePatternFromPromptOutput - The return type for the generatePatternFromPrompt function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GeneratePatternFromPromptInputSchema = z.object({
  prompt: z.string().describe('A text description of the desired symmetrical pattern.'),
});
export type GeneratePatternFromPromptInput = z.infer<typeof GeneratePatternFromPromptInputSchema>;

const GeneratePatternFromPromptOutputSchema = z.object({
  pattern: z.array(z.number().int().min(0).max(35))
    .describe('A JSON array of integers representing the indices of triangles to be colored in a 36-triangle grid. The pattern must exhibit 3-fold rotational symmetry. For example, if triangle X is colored, its two rotationally symmetric counterparts must also be colored. The indices range from 0 to 35.'),
});
export type GeneratePatternFromPromptOutput = z.infer<typeof GeneratePatternFromPromptOutputSchema>;

const prompt = ai.definePrompt({
  name: 'generatePatternPrompt',
  input: {schema: GeneratePatternFromPromptInputSchema},
  output: {schema: GeneratePatternFromPromptOutputSchema},
  prompt: `You are an expert in generative art and symmetrical patterns.
Your task is to generate a 3-fold rotationally symmetrical grid pattern for a 36-triangle grid based on the user's description.

The grid consists of 36 triangles, indexed from 0 to 35.
3-fold rotational symmetry means that if you rotate the entire grid by 120 degrees, the pattern appears identical.
This implies that for any triangle you choose to color at index 'i', its two rotationally symmetric counterparts must also be colored.

For example, if the grid is visualized as 3 segments of 12 triangles each, and triangle '0' is in the first segment, its counterparts might be '12' in the second segment and '24' in the third segment. You need to ensure this relationship holds for all chosen triangles.

Generate a JSON array of integers, where each integer is an index of a triangle to be colored (0-35). Ensure the resulting array strictly adheres to 3-fold rotational symmetry.

User's desired pattern: {{{prompt}}}`,
});

const generatePatternFromPromptFlow = ai.defineFlow(
  {
    name: 'generatePatternFromPromptFlow',
    inputSchema: GeneratePatternFromPromptInputSchema,
    outputSchema: GeneratePatternFromPromptOutputSchema,
  },
  async (input) => {
    const {output} = await prompt(input);
    return output!;
  }
);

export async function generatePatternFromPrompt(
  input: GeneratePatternFromPromptInput
): Promise<GeneratePatternFromPromptOutput> {
  return generatePatternFromPromptFlow(input);
}
