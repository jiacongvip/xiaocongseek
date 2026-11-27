import asyncio
from pathlib import Path
from conf import BASE_DIR
from .baseFileUploader import BaseFileUploader, run_upload
from .wechatOfficialApiPublisher import publish_wechat_official_via_api
from utils.wechat_official import is_wechat_official_api_account_file
from utils.files_times import generate_schedule_time_next_day

def resolve_runtime_path(path_value, default_subdir):
    """
    兼容项目内相对路径和外部传入的绝对路径
    """
    if path_value in (None, ""):
        return None
    path = Path(path_value)
    if path.is_absolute():
        return path
    return Path(BASE_DIR / default_subdir / path)


def should_bundle_graphic_files(platform, file_type, files):
    normalized_files = [file for file in files if file]
    return int(file_type or 0) == 1 and len(normalized_files) > 1 and platform in {"douyin", "xiaohongshu", "tencent"}


def build_upload_units(platform, file_type, files):
    normalized_files = [file for file in files if file]
    if should_bundle_graphic_files(platform, file_type, normalized_files):
        return [normalized_files]
    return normalized_files or [None]


def describe_upload_unit(upload_unit, title="", content_mode=None):
    if isinstance(upload_unit, list):
        normalized_files = [file for file in upload_unit if isinstance(file, Path)]
        if not normalized_files:
            return title or content_mode or "文本内容"
        if len(normalized_files) == 1:
            return normalized_files[0].name
        return f"{normalized_files[0].name} 等{len(normalized_files)}个文件"
    if isinstance(upload_unit, Path):
        return upload_unit.name
    return title or content_mode or "文本内容"

def post_file(platform, account_file, file_type, files, title, text, tags, thumbnail_path, location, enableTimer=False, videos_per_day=1, daily_times=None, start_days=0, content_mode=None, publish_driver=None, is_draft=False, forum_name=None, article_doc=None, headless_override=None, progress_callback=None, snapshot_callback=None, desktop_runner_id=None):
    """
    批量发布多个文件到某个平台
    参数:
        platform: 平台名称
        account_file: 账号文件列表
        file_type: 文件类型，1-图文 2-视频
        files: 文件列表
        title: 视频标题
        text: 视频正文描述
        tags: 视频标签，多个标签用逗号隔开
        thumbnail_path: 视频缩略图路径
        location: 视频地点
        enableTimer: 是否开启定时发布
        videos_per_day: 每天发布视频数量
        daily_times: 每天发布时间列表
        start_days: 开始发布时间偏移天数
    """

    try:
        # 生成文件的完整路径
        normalized_account_files = []
        for account in account_file:
            if isinstance(account, dict):
                account_path = account.get("filePath")
            else:
                account_path = account
            normalized_account_files.append(resolve_runtime_path(account_path, "cookiesFile"))

        account_file = normalized_account_files
        files = [resolve_runtime_path(file, "videoFile") for file in files] if files else []
        api_publish_files = [file for file in files if file]
        upload_units = build_upload_units(platform, file_type, files)
        file_num = len(upload_units)

        if platform == "wechat_official" and publish_driver == "api":
            article_label = title or text or "公众号文章"
            last_error_msg = ""
            if callable(progress_callback):
                progress_callback(f"{platform}：开始处理内容 1/1 - {article_label}")
            for cookie in account_file:
                try:
                    if callable(progress_callback):
                        progress_callback(f"{platform}：正在尝试账号 {cookie}")
                    publish_result = publish_wechat_official_via_api(
                        cookie,
                        api_publish_files,
                        title,
                        text,
                        is_draft=is_draft,
                    )
                    if publish_result:
                        print(f"{platform}文章发布成功")
                        if callable(progress_callback):
                            progress_callback(f"{platform}：内容发布成功", "success")
                        return {
                            "success": True,
                            "result_url": "",
                            "result_url_type": "",
                            "result_url_label": "",
                            "error_msg": "",
                        }
                    last_error_msg = f"{platform} API 发布失败"
                    if callable(progress_callback):
                        progress_callback(f"{platform}：当前账号发布失败，尝试下一个账号", "warning")
                except Exception as e:
                    print(f"{platform}文章发布失败: {str(e)}")
                    last_error_msg = str(e)
                    if callable(progress_callback):
                        progress_callback(f"{platform}：发布异常 - {str(e)}", "error")
                    continue
            return {
                "success": False,
                "result_url": "",
                "result_url_type": "",
                "result_url_label": "",
                "error_msg": last_error_msg or f"{platform}文章发布失败",
            }

        if enableTimer:
            publish_datetimes = generate_schedule_time_next_day(file_num, videos_per_day,daily_times, start_days)
        else:
            publish_datetimes = 0

        success_count = 0
        any_published = False
        last_error_msg = ""
        first_success_result = {
            "result_url": "",
            "result_url_type": "",
            "result_url_label": "",
        }
        for index, file in enumerate(upload_units):
            file_published = False
            file_label = describe_upload_unit(file, title, content_mode)
            if callable(progress_callback):
                progress_callback(f"{platform}：开始处理内容 {index + 1}/{file_num} - {file_label}")
            for cookie in account_file:
                try:
                    if callable(progress_callback):
                        progress_callback(f"{platform}：正在尝试账号 {cookie}")
                    if platform == "wechat_official" and (
                        publish_driver == "api" or is_wechat_official_api_account_file(cookie)
                    ):
                        publish_result = publish_wechat_official_via_api(
                            cookie,
                            [file] if isinstance(file, Path) else [],
                            title,
                            text,
                            is_draft=is_draft,
                        )
                    else:
                        # 使用独立的run_upload函数来执行上传
                        publish_date = publish_datetimes[index] if isinstance(publish_datetimes, list) else publish_datetimes
                        publish_result = asyncio.run(
                            run_upload(
                                platform,
                                cookie,
                                file_type,
                                file,
                                title,
                                text,
                                tags,
                                thumbnail_path,
                                location,
                                publish_date,
                                content_mode=content_mode,
                                is_draft=is_draft,
                                forum_name=forum_name,
                                article_doc=article_doc,
                                headless_override=headless_override,
                                progress_callback=progress_callback,
                                snapshot_callback=snapshot_callback,
                                desktop_runner_id=desktop_runner_id,
                            )
                        )
                    publish_success = bool(publish_result.get("success")) if isinstance(publish_result, dict) else bool(publish_result)
                    current_error_msg = str(publish_result.get("error_msg") or "").strip() if isinstance(publish_result, dict) else ""

                    # 是否成功发布
                    if publish_success:
                        print(f"{platform}文件{file_label}发布成功")
                        if callable(progress_callback):
                            progress_callback(f"{platform}：内容 {index + 1}/{file_num} 发布成功", "success")
                        success_count += 1
                        file_published = True
                        any_published = True
                        if isinstance(publish_result, dict) and not first_success_result["result_url"]:
                            first_success_result = {
                                "result_url": str(publish_result.get("result_url") or ""),
                                "result_url_type": str(publish_result.get("result_url_type") or ""),
                                "result_url_label": str(publish_result.get("result_url_label") or ""),
                            }
                        # 当前文件已有账号发布成功，跳过其他账号
                        break
                    else:
                        if current_error_msg:
                            last_error_msg = current_error_msg
                        print(f"{platform}文件{file_label}发布失败，尝试下一个账号")
                        if callable(progress_callback):
                            progress_callback(f"{platform}：当前账号发布失败，尝试下一个账号", "warning")
                except Exception as e:
                    print(f"{platform}文件{file_label}发布失败: {str(e)}")
                    last_error_msg = str(e)
                    if callable(progress_callback):
                        progress_callback(f"{platform}：发布异常 - {str(e)}", "error")
                    # 继续尝试其他账号，不中断当前文件的发布
                    continue
            
            # 任务进度 - 显示成功数量/总数量
            print(f"{platform}已发布{success_count}/{file_num}条内容")
        
        # 全部发布完毕后，显示最终结果
        if success_count == file_num:
            print(f"{platform}所有内容发布完成")
        else:
            print(f"{platform}发布完成，成功发布{success_count}/{file_num}条内容")
        # 如果有文件发布成功，返回True
        if any_published:
            return {
                "success": True,
                "result_url": first_success_result["result_url"],
                "result_url_type": first_success_result["result_url_type"],
                "result_url_label": first_success_result["result_url_label"],
                "error_msg": "",
            }
        else:
            return {
                "success": False,
                "result_url": "",
                "result_url_type": "",
                "result_url_label": "",
                "error_msg": last_error_msg or f"{platform}发布失败",
            }
    except Exception as e:
        print(f"{platform}文件发布过程中发生异常: {str(e)}")
        return {
            "success": False,
            "result_url": "",
            "result_url_type": "",
            "result_url_label": "",
            "error_msg": str(e),
        }


#批量发布单个文件到多个平台
def post_single_file_to_multiple_platforms(platforms, account_files, file_type, file, title, text, tags, thumbnail_path, location, enableTimer=False, videos_per_day=1, daily_times=None, start_days=0):
    """
    批量发布单个文件到多个平台
    参数:
        platforms: 平台名称列表
        account_files: 账号文件字典，key为平台名称，value为该平台对应的账号文件列表
        file_type: 文件类型，1-图文 2-视频
        file: 单个文件路径
        title: 视频标题
        text: 视频正文描述
        tags: 视频标签，多个标签用逗号隔开
        thumbnail_path: 视频缩略图路径
        location: 视频地点
        enableTimer: 是否开启定时发布
        videos_per_day: 每天发布视频数量
        daily_times: 每天发布时间列表
        start_days: 开始发布时间偏移天数
    返回值:
        bool: 所有平台发布是否全部成功
    """

    try:
        # 生成文件的完整路径
        file = resolve_runtime_path(file, "videoFile")
        platform_num = len(platforms)
        success_count = 0

        # 单个文件发布，不需要生成多个时间点
        if enableTimer:
            # 生成一个发布时间点
            publish_datetimes = generate_schedule_time_next_day(1, videos_per_day, daily_times, start_days)
        else:
            publish_datetimes = 0

        for index, platform in enumerate(platforms):
            # 获取当前平台对应的账号文件列表
            if platform in account_files:
                platform_accounts = account_files[platform]
                platform_accounts = [resolve_runtime_path(account, "cookiesFile") for account in platform_accounts]
            else:
                print(f"平台{platform}没有对应的账号文件，跳过发布")
                continue

            for cookie in platform_accounts:
                try:
                    # 使用独立的run_upload函数来执行上传
                    publish_result = asyncio.run(run_upload(platform, cookie, file_type, file, title, text, tags, thumbnail_path, location, publish_datetimes))
                    publish_success = bool(publish_result.get("success")) if isinstance(publish_result, dict) else bool(publish_result)
                    
                    # 是否成功发布
                    if publish_success:
                        print(f"{platform}文件{file.name}发布成功")
                        success_count += 1
                        # 一个平台只需要用一个账号发布成功即可
                        break
                    else:
                        print(f"{platform}文件{file.name}发布失败，尝试下一个账号")
                except Exception as e:
                    print(f"{platform}文件{file.name}发布失败: {str(e)}")
                    # 继续尝试其他账号，不中断当前平台的发布
                    continue
            
            # 任务进度 - 显示成功数量/总数量
            print(f"已发布到{success_count}/{platform_num}个平台")
        
        # 全部发布完毕后
        if success_count == platform_num:
            print(f"所有平台发布完成，成功发布到{success_count}/{platform_num}个平台")
            return True
        else:
            print(f"发布完成，但部分平台发布失败，成功发布到{success_count}/{platform_num}个平台")
            return False
    except Exception as e:
        print(f"文件发布过程中发生异常: {str(e)}")
        return False


def post_multiple_files_to_multiple_platforms(platforms, account_files, file_type, files, title, text, tags, thumbnail_path, location, enableTimer=False, videos_per_day=1, daily_times=None, start_days=0):
    """
    批量发布多个文件到多个平台
    参数:
        platforms: 平台名称列表
        account_files: 账号文件字典，key为平台名称，value为该平台对应的账号文件列表
        file_type: 文件类型，1-图文 2-视频
        files: 文件列表
        title: 视频标题
        text: 视频正文描述
        tags: 视频标签，多个标签用逗号隔开
        thumbnail_path: 视频缩略图路径
        location: 视频地点
        enableTimer: 是否开启定时发布
        videos_per_day: 每天发布视频数量
        daily_times: 每天发布时间列表
        start_days: 开始发布时间偏移天数
    返回值:
        dict: 发布结果字典，key为平台名称，value为该平台的发布结果（成功数量/总数量）
    """

    try:
        # 生成文件的完整路径
        files = [resolve_runtime_path(file, "videoFile") for file in files]

        # 初始化发布结果字典
        publish_results = {}
        for platform in platforms:
            upload_units = build_upload_units(platform, file_type, files)
            publish_results[platform] = {"success": 0, "total": len(upload_units)}

            # 获取当前平台对应的账号文件列表
            if platform in account_files:
                platform_accounts = account_files[platform]
                platform_accounts = [resolve_runtime_path(account, "cookiesFile") for account in platform_accounts]
            else:
                print(f"平台{platform}没有对应的账号文件，跳过发布")
                continue

            # 生成当前平台的发布时间点
            if enableTimer:
                publish_datetimes = generate_schedule_time_next_day(len(upload_units), videos_per_day, daily_times, start_days)
            else:
                publish_datetimes = 0

            for file_index, upload_unit in enumerate(upload_units):
                file_label = describe_upload_unit(upload_unit, title, None)
                print(f"\n开始处理平台 {platform} 的内容 {file_index+1}/{len(upload_units)}: {file_label}")

                published = False
                publish_date = publish_datetimes[file_index] if isinstance(publish_datetimes, list) else publish_datetimes
                for cookie in platform_accounts:
                    try:
                        # 使用独立的run_upload函数来执行上传
                        publish_result = asyncio.run(
                            run_upload(
                                platform,
                                cookie,
                                file_type,
                                upload_unit,
                                title,
                                text,
                                tags,
                                thumbnail_path,
                                location,
                                publish_date,
                            )
                        )
                        publish_success = bool(publish_result.get("success")) if isinstance(publish_result, dict) else bool(publish_result)

                        # 是否成功发布
                        if publish_success:
                            print(f"{platform}内容{file_label}发布成功")
                            publish_results[platform]["success"] += 1
                            published = True
                            break
                        else:
                            print(f"{platform}内容{file_label}发布失败，尝试下一个账号")
                    except Exception as e:
                        print(f"{platform}内容{file_label}发布失败: {str(e)}")
                        # 继续尝试其他账号，不中断当前平台的发布
                        continue

                if not published:
                    print(f"{platform}内容{file_label}所有账号发布失败")
        
        # 输出最终发布结果
        print("\n=== 发布结果汇总 ===")
        for platform, result in publish_results.items():
            success = result["success"]
            total = result["total"]
            print(f"{platform}: 成功 {success}/{total}")
        
        return publish_results
    except Exception as e:
        print(f"文件发布过程中发生异常: {str(e)}")
        return {}
