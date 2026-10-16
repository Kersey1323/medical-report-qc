REFERENCE_PROMPT = """中文医学影像报告语法纠错任务。采用最小修改原则，不改变临床事实，只输出纠正后的完整报告。
示例原始报告：双侧胸腔未见积液以及并、积气征。
示例纠正报告：双侧胸腔未见积液、积气征。
待纠正原始报告：{source}
教师参考纠正：{reference_correction}
纠正后的完整报告："""


def make_reference_prompt(source, reference_correction):
    return REFERENCE_PROMPT.format(
        source=source, reference_correction=reference_correction
    )
