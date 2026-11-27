# 平台配置字典
PLATFORM_CONFIGS = {
    "xiaohongshu": {
        #平台类型编号
        "type": 1,
        #平台名称
        "platform_name": "xiaohongshu",
        #平台个人中心URL
        "personal_url": "https://creator.xiaohongshu.com/new/home",
        #平台登录URL
        "login_url": "https://creator.xiaohongshu.com/login",
        #平台视频发布URL
        "creator_video_url": "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video&openFilePicker=true",
        #平台图片发布URL
        "creator_image_url": "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image&openFilePicker=true",
        "selectors": {
            #上传按钮选择器
            "upload_button": ['input.upload-input[type="file"]'],
            "direct_file_input": [
                'input.upload-input[type="file"]',
                'input[type="file"][accept*="image/"]'
            ],
            #发布按钮选择器
            "publish_button": ['div.d-button-content span.d-text:has-text("发布")'],
            #标题编辑器选择器
            "title_editor": [
                'input.d-text[type="text"][placeholder*="填写标题"]',
                '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
                '[aria-placeholder*="分享你的新鲜事"][contenteditable="true"]',
                '[aria-label="Add a description"]',
                '[aria-label="Write something..."]'
            ],
            #正文编辑器输入框选择器
            "textbox_selectors": [
                'div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]'
            ],
            #封面按钮选择器
            "thumbnail_button": ["//span[contains(text(), 'Add')]", "//span[contains(text(), '添加')]"],
            #封面确认按钮选择器
            "thumbnail_finish": ['button.cheetah-btn.cheetah-btn-primary.cheetah-btn-solid:has-text("确定")'],
            #定时按钮选择器
            "schedule_button": ["//span[text()='Schedule']", "//span[text()='定时']"],
            #日期输入选择器
            "date_input": '[aria-label="Date"]',
            #时间输入选择器
            "time_input": '[aria-label="Time"]',
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": True,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    "tencent": {
        "type": 2,
        "platform_name": "tencent",
        "auth_cookie_names": [
            "sessionid",
            "wxuin",
        ],
        "personal_url": "https://channels.weixin.qq.com/platform/",
        "login_url": "https://channels.weixin.qq.com/login.html",
        "creator_video_url": "https://channels.weixin.qq.com/platform/post/create",
        "creator_image_url": "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate",
        "selectors": {
            "upload_button": [
                'span.add-icon.weui-icon-outlined-add',
                'div.upload-content',
                '#container-wrap > div.container-center > div > div.main-body-wrap > div.main-body > div.weui-desktop-block.main-card > div > div > div > div:nth-child(2) > div.feed-list-opt > div.video-btn-wrap > div > button',
                'xpath=/html/body/div[1]/div/div[2]/div[2]/div/wujie-app//html/body/div/div/div/div[2]/div/div[1]/div[2]/div[2]/div/div/div/div[2]/div[1]/div[2]/div/button',
                'button.weui-desktop-btn.weui-desktop-btn_primary:has-text("发表视频")'
            ],
            "publish_button": ['button.weui-desktop-btn.weui-desktop-btn_primary:has-text("发表")', 'button.weui-desktop-btn:has-text("发表")'],
            "title_editor": [
                'input.weui-desktop-form__input[placeholder="概括视频主要内容，字数建议6-16个字符"]',
                'input.weui-desktop-form__input[placeholder*="标题"]',
                'input[placeholder*="标题"]',
                'input[placeholder*="概括"]',
            ],
            "textbox_selectors": [
                'div.input-editor[contenteditable="true"][data-placeholder="添加描述"]',
                'div.input-editor[data-placeholder="添加描述"]',
                'div[contenteditable="true"][data-placeholder="添加描述"]',
                'div[contenteditable="plaintext-only"][data-placeholder="添加描述"]',
                'div[role="textbox"][data-placeholder="添加描述"]',
                'div[contenteditable="true"][data-placeholder*="描述"]',
                'div[contenteditable="plaintext-only"][data-placeholder*="描述"]',
                'div[role="textbox"][data-placeholder*="描述"]',
                'div[contenteditable="true"][aria-placeholder*="描述"]',
                'div[contenteditable="true"][placeholder*="描述"]',
                'div.input-editor[contenteditable=""]',
                'div[role="textbox"][contenteditable="true"]'
            ],
            "thumbnail_button": ["//span[contains(text(), '添加封面')]"],
            "thumbnail_finish": ['button.cheetah-btn.cheetah-btn-primary.cheetah-btn-solid:has-text("确定")'],
            "schedule_button": ['label:has-text("定时")'],
            "date_input": ['input[placeholder="请选择发表时间"]'],
            "time_input": ['input[placeholder="请选择时间"]'],
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": True,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    "douyin": {
        "type": 3,
        "platform_name": "douyin",
        "personal_url": "https://creator.douyin.com/creator-micro/home",
        "login_url": "https://creator.douyin.com/login",
        "creator_video_url": "https://creator.douyin.com/creator-micro/content/upload",
        "creator_image_url": "https://creator.douyin.com/creator-micro/content/upload?default-tab=3",
        "selectors": {
            "upload_button": ['span.semi-button-content-right:has-text("上传视频")', 'span.semi-button-content-right:has-text("上传图文")'],
            "direct_file_input": [
                'input[type="file"][accept*="image/"]',
                'input[type="file"][multiple]'
            ],
            "publish_button": ['role=button[name="发布"]', 'button:has-text("发布"):not(:has-text("高清发布"))', 'text="发布"'],
            "title_editor": ['input[placeholder="填写作品标题，为作品获得更多流量"]', 'input.semi-input.semi-input-default'],
            "textbox_selectors": [
                'div.zone-container.editor-kit-container.editor.editor-comp-publish[contenteditable="true"]',
                'div[data-line-wrapper="true"]',
            ],
            "thumbnail_button": ["//span[contains(text(), '添加封面')]"],
            "thumbnail_finish": ['button.semi-button-content-right:has-text("完成")'],
            "schedule_button": ['button:has-text("定时发布")'],
            "date_input": ['.el-input__inner[placeholder="选择日期和时间"]'],
            "time_input": ['.el-input__inner[placeholder="选择日期和时间"]'],
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": True,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    "kuaishou": {
        "type": 4,
        "platform_name": "kuaishou",
        "personal_url": "https://cp.kuaishou.com/profile",
        "login_url": "https://passport.kuaishou.com/pc/account/login",
        "creator_video_url": "https://cp.kuaishou.com/article/publish/video?tabType=1",
        "creator_image_url": "https://cp.kuaishou.com/article/publish/video?tabType=2",
        "selectors": {
            "upload_button": ['button:has-text("上传图片")', 'button:has-text("上传视频")'],
            "publish_button": ['div._button_3a3lq_1._button-primary_3a3lq_60:has-text("发布")', 'div:has-text("发布")', 'text="发布"'],
            #标题编辑器选择器
            "title_editor": ['div:has-text("描述") + div'],
            #正文编辑器输入框选择器
            "textbox_selectors": [
                'div#work-description-edit',
                'div#work-description-edit[contenteditable="true"]',
                'div#work-description-edit[contenteditable="true"][placeholder="添加合适的话题和描述，作品能获得更多推荐～"]',
                'div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]',
                '[contenteditable="true"][placeholder*="添加合适的话题和描述"]',
            ],
            "thumbnail_button": ["//span[contains(text(), '封面编辑')]"],
            "thumbnail_finish": ['button:has-text("完成")'],
            "schedule_button": ['label:text("发布时间") + div .ant-radio-input'],
            "date_input": ['div.ant-picker-input input[placeholder="选择日期时间"]'],
            "time_input": ['div.ant-picker-input input[placeholder="选择日期时间"]'],
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": False,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    "tiktok": {
        "type": 5,
        "platform_name": "tiktok",
        "personal_url": "https://www.tiktok.com/setting",
        "login_url": "https://www.tiktok.com/login?lang=en",
        "creator_video_url": "https://www.tiktok.com/tiktokstudio/upload?lang=en",
        "creator_image_url": "https://www.tiktok.com/tiktokstudio/upload?lang=en",
        "selectors": {
            "upload_button": ['button:has-text("Select video"):visible'],
            "publish_button": ['button[data-e2e="post_video_button"]', 'button:has-text("Post")', 'role=button[name="Post"]'],
            "title_editor": ['div.public-DraftEditor-content'],
            "textbox_selectors": [
                'div.public-DraftEditor-content[contenteditable="true"]',
                'div.caption-editor'
            ],
            "thumbnail_button": [".cover-container"],
            "thumbnail_finish": ['button:has-text("Done")'],
            "schedule_button": ["//span[text()='Schedule']", "//span[text()='定时']"],
            "date_input": '[aria-label="Date"]',
            "time_input": '[aria-label="Time"]',
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": False,
            #是否支持标题
            "title": False,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    "instagram": {
        "type": 6,
        "platform_name": "instagram",
        "personal_url": "https://www.instagram.com",
        "login_url": "https://www.instagram.com/accounts/login/",
        "creator_video_url": "https://business.facebook.com/latest/composer/",
        "creator_image_url": "https://business.facebook.com/latest/composer/",
        "selectors": {
            "upload_button": [
                'div[role="button"]:has-text("Add photo/video")',
                '#mount_0_0_1o > div > div:nth-child(1) > div > div.x9f619.x1n2onr6.x1ja2u2z > div > div > div.x78zum5.xdt5ytf.x10cihs4.x1t2pt76.x1n2onr6.x1ja2u2z > span > div > div > div._6g3g.x1ja2u2z.xeuugli.xh8yej3.x1q85c4o.x1kgee58 > div.x2atdfe.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x1n2onr6.x1ja2u2z.xw2csxc.x7p5m3t.x1odjw0f.x1e4zzel.x5yr21d > div > div:nth-child(2) > div > div:nth-child(1) > div > div > div > div > div > div:nth-child(2) > div > div > div.x78zum5.xdt5ytf.x2lwn1j.xeuugli.x1c4vz4f.x2lah0s.x1g14t1j > div.x78zum5.xdt5ytf.x2lwn1j.xeuugli.x14rvwrp.x1nn3v0j.x18d9i69.xyiysdx.xv54qhq.x1odjw0f.x6ikm8r.x5yr21d > div:nth-child(2) > div > div.x9f619.x78zum5.x1iyjqo2.x5yr21d.x2lwn1j.x1n2onr6.xh8yej3 > div.xw2csxc.x1odjw0f.xh8yej3.x18d9i69 > div.x1iyjqo2.xs83m0k.xdl72j9.x3igimt.xedcshv.x1t2pt76.x1l90r2v.xf7dkkf.xv54qhq.xexx8yu > div.x6s0dn4.x78zum5.x1q0g3np.x1a02dak.x2lwn1j.xeuugli.x1iyjqo2.xbiq8gi > div > div > div > div > span > div > div > div.x1vvvo52.x1fvot60.xk50ysn.xxio538.x1heor9g.xuxw1ft.x6ikm8r.x10wlt62.xlyipyv.x1h4wwuj.xeuugli'
            ],
            "publish_button": ['*[role="button"]:has(:text("Publish"))'],
            "title_editor": [
                'div[role="combobox"][contenteditable="true"][aria-label*="Write into the dialogue box"]'
                ],
            #正文编辑器输入框选择器
            "textbox_selectors": [
                'div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]',
                '#mount_0_0_Wk > div > div:nth-child(1) > div > div.x9f619.x1n2onr6.x1ja2u2z > div > div > div.x78zum5.xdt5ytf.x10cihs4.x1t2pt76.x1n2onr6.x1ja2u2z > span > div > div > div._6g3g.x1ja2u2z.xeuugli.xh8yej3.x1q85c4o.x1kgee58 > div.x2atdfe.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x1n2onr6.x1ja2u2z.xw2csxc.x7p5m3t.x1odjw0f.x1e4zzel.x5yr21d > div > div:nth-child(2) > div > div:nth-child(1) > div > div > div > div > div > div:nth-child(2) > div > div > div.x78zum5.xdt5ytf.x2lwn1j.xeuugli.x1c4vz4f.x2lah0s.x1g14t1j > div.x78zum5.xdt5ytf.x2lwn1j.xeuugli.x14rvwrp.x1nn3v0j.x18d9i69.xyiysdx.xv54qhq.x1odjw0f.x6ikm8r.x5yr21d > div:nth-child(5) > div > div.x9f619.x78zum5.x1iyjqo2.x5yr21d.x2lwn1j.x1n2onr6.xh8yej3 > div.xw2csxc.x1odjw0f.xh8yej3.x18d9i69 > div.x1iyjqo2.xs83m0k.xdl72j9.x3igimt.xedcshv.x1t2pt76.x1l90r2v.xf7dkkf.xv54qhq.xexx8yu > div.xwya9rg > div > div > div.x6s0dn4.x78zum5.x2lwn1j.xeuugli > div > div > div > div.x6s0dn4.x78zum5.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu.x178xt8z.x1lun4ml.xso031l.xpilrb4.xwebqov.x1x9jw1y.xrsgblv.xceihxd.xjwep3j.x1t39747.x1wcsgtt.x1pczhz8.x1gzqxud.xbsr9hj.xm7lytj.x1ykpatu.x1iwz3mf.x1kukv79.x15x72sd > div.x6s0dn4.x78zum5.x1q0g3np.xozqiw3.x2lwn1j.xeuugli.x1iyjqo2.x8va1my > div > div > div > div.xjbqb8w.x972fbf.x10w94by.x1qhh985.x14e42zd.xdj266r.x14z9mp.xat24cr.x1lziwak.x1t137rt.xexx8yu.xyri2b.x18d9i69.x1c1uobl.xlyipyv.xwd1esu.x1gnnqk1.xbsr9hj.x1urst0s.x1glnyev.x1ad04t7.x1ix68h3.x19gujb8.xni1clt.x1tutvks.xfrpkgu.x1vvvo52.x1fvot60.xo1l8bm.xxio538.xh8yej3.xl8z2ie.x1ujl9rh.xw2csxc.x1odjw0f.xjbqb8w.x972fbf.x10w94by.x1qhh985.x14e42zd.xdj266r.x14z9mp.xat24cr.x1lziwak.x1t137rt.xexx8yu.xyri2b.x18d9i69.x1c1uobl.xlyipyv.xwd1esu.x1gnnqk1.xbsr9hj.x1urst0s.x1glnyev.x1ad04t7.x1ix68h3.x19gujb8.xni1clt.x1tutvks.xfrpkgu.x1vvvo52.x1fvot60.xo1l8bm.xxio538.xh8yej3.xl8z2ie.x1ujl9rh.xw2csxc.x1odjw0f',
                'xpath=/html/body/div[2]/div/div[1]/div/div[2]/div/div/div[1]/span/div/div/div[1]/div[1]/div/div[2]/div/div[1]/div/div/div/div/div/div[2]/div/div/div[1]/div[1]/div[5]/div/div[2]/div[1]/div[2]/div[2]/div/div/div[2]/div/div/div/div[1]/div[3]/div/div/div/div[1]',
                'div._5yk2 > div._5rp7 > div._5rpb > div[contenteditable="true"][role="combobox"][aria-label*="Write into the dialogue box"]'
            ],
            "thumbnail_button": ["//span[contains(text(), '选择封面')]"],
            "thumbnail_finish": ['button:has-text("完成")'],
            "schedule_button": ['#video_upload > div > div:nth-child(2) > div > div.time > div > div > div:nth-child(2) > label'],
            "date_input": ['#video_upload > div > div:nth-child(2) > div > div.time > div > div > div:nth-child(2) > div > input'],
            "time_input": ['#video_upload > div > div:nth-child(2) > div > div.time > div > div > div:nth-child(2) > div > input'],
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": False,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    #facebook
    "facebook": {
        "type": 7,
        "platform_name": "facebook",
        "personal_url": "https://www.facebook.com/profile.php",
        "login_url": "https://www.facebook.com/login",
        "creator_video_url": "https://www.facebook.com/",
        "creator_image_url": "https://www.facebook.com/",
        "selectors": {
            "upload_button": ['div[aria-label="照片/视频"]','div[aria-label="Photo/Video"]'],
            "publish_button": ['//span[text()="发帖"]','//span[text()="Post"]','//span[text()="Schedule"]','//span[text()="发布"]'],
            #标题编辑器选择器
            "title_editor": [
                # 中文界面选择器
                '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
                '[aria-placeholder*="分享你的新鲜事"][contenteditable="true"]',
                # 英文界面选择器
                '[aria-label="Add a description"]',
                '[aria-label="Write something..."]'],
            #正文编辑器输入框选择器
            "textbox_selectors": [
                'div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]'
            ],
            "thumbnail_button": ["//span[contains(text(), 'Add')]","//span[contains(text(), '添加')]"],
            "thumbnail_finish": ['button:has-text("完成")'],
            "schedule_button": ["//span[text()='Schedule']","//span[text()='定时']"],
            "date_input": ['.date-picker-input'],
            "time_input": ['.time-picker-input'],
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": True,
            #是否支持正文
            "textbox": False,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    "bilibili": {
        "type": 8,
        "platform_name": "bilibili",
        "personal_url": "https://member.bilibili.com/platform/home",
        "login_url": "https://passport.bilibili.com/login",
        "creator_video_url": "https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload",
        "creator_image_url": "https://member.bilibili.com/platform/upload/video/frame",
        "selectors": {
            "upload_button": ['#video-up-app > div.video-entrance > div.upload-body > div > div.upload-wrp > div > div > div','#video-up-app > div.video-complete > div.content-wrapper > div > div.op-buttons > button > span'],
            "publish_button": ['span.submit-add:has-text("立即投稿")'],
            #标题编辑器选择器
            "title_editor": ['input.input-val[type="text"][placeholder="请输入稿件标题"]'],
            #正文编辑器输入框选择器
            "textbox_selectors": [
                'div.ql-editor.ql-blank[contenteditable="true"][data-placeholder="填写更全面的相关信息，让更多的人能找到你的视频吧"]'
            ],
            "thumbnail_button": ["//span[contains(text(), '添加封面')]"],
            "thumbnail_finish": ['button:has-text("完成")'],
            "schedule_button": ['button:has-text("定时发布")'],
            "date_input": ['.date-picker-input'],
            "time_input": ['.time-picker-input'],
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": True,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": False,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    #baijiahao
    "baijiahao": {
        "type": 9,
        "platform_name": "baijiahao",
        "personal_url": "https://baijiahao.baidu.com/builder/rc/home",
        "login_url": "https://baijiahao.baidu.com/builder/theme/bjh/login",
        "creator_video_url": "https://baijiahao.baidu.com/builder/rc/edit?type=videoV2&is_from_cms=1",
        "creator_image_url": "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1",
        "selectors": {
            "upload_button": [
                'div._5eb0d99a7a8a2180-uploadEventContainer',
                '#root > div > div.mp-container.mp-container-edit > div > div.scale-box > div > div > div > section > div > div.video-main-container > div.e844194154160364-blankWrap > div > div._5eb0d99a7a8a2180-inputWrap > div',
                'xpath=/html/body/div/div/div[1]/div/div[2]/div/div/div/section/div/div[1]/div[1]/div/div[2]/div'
                ],
            "publish_button": [
                '#new-operator-content > div > span > span.op-list-right > div:nth-child(3) > button',
                'xpath=/html/body/div[1]/div/div[1]/div/div[2]/div/div/div/div[3]/div/span/span[2]/div[3]/button'
                ],
            #标题编辑器选择器
            "title_editor": [
                '.videov2-title-wrap [contenteditable="true"][role="textbox"]',
                '[aria-placeholder*="添加标题"][contenteditable="true"]',
                '#formMain > form > div.left-area-content-box > div:nth-child(2) > div.form-inner-wrap.tags-container.videov2-title-wrap > div > div.cheetah-public.cheetah-textArea.acss-zwcv9m.autoSize > textarea',
                'xpath=/html/body/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/form/div[1]/div[2]/div[2]/div/div[1]/textarea'
                ],
            #正文编辑器输入框选择器
            "textbox_selectors": [
                '#desc',
                'textarea[placeholder*="让别人更懂你"]',
                'textarea[placeholder*="客观描述视频内容"]',
                'xpath=/html/body/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/form/div[1]/div[11]/div[2]/div[2]/div/textarea'
            ],
            "thumbnail_button": [
                '.form-cover [data-testid="select-cover"]',
                '.form-cover .d820b38cbcd0c526-text[data-testid="select-cover"]',
                "#formMain > form > div.left-area-content-box > div.form-item-line-content-24.form-item-line-content-cover.form-cover > div.form-inner-wrap > div.d01689d7d733c6fb-coverWrap > div:nth-child(1) > div > span > div > span > div > div > div > div > div.d820b38cbcd0c526-icon",
                'xpath=/html/body/div[1]/div/div[1]/div/div[2]/div/div/div/div[2]/div/form/div[1]/div[1]/div[2]/div[1]/div[1]/div/span/div/span/div/div/div/div'
            ],
            "thumbnail_finish": [
                '#rc-tabs-0-panel-1 > div > div._37e9eeb539c7e75d-footer > button.cheetah-btn.css-zneqgo.cheetah-btn-primary.cheetah-btn-solid.cheetah-public.acss-qlkyg1.acss-1kjo6pu.acss-1tjgk22.acss-yhl6pe.acss-uv0qn4.acss-58e25w.acss-1grxnxm.acss-1izrri0.cheetah-btn-L.cheetah-btn-text-primary',
                'xpath=/html/body/div[2]/div/div[2]/div/div[1]/div/div/div/div[2]/div/div/div/div[2]/button[2]',
                'button.cheetah-btn.cheetah-btn-primary.cheetah-btn-solid:has-text("确定")'
            ],
            "schedule_button": ['button:has-text("定时发布")'],
            "date_input": ['.date-picker-input'],
            "time_input": ['.time-picker-input'],
        },
        "features": {
            # 平台功能支持
            #是否跳过Cookie验证
            "skip_cookie_verify": True,
            #是否支持图文发布
            "image_publish": True,
            #是否支持标题
            "title": True,
            #是否支持正文
            "textbox": True,
            #是否支持标签
            "tags": True,
            #是否支持封面
            "thumbnail": True,
            #是否支持地点
            "location": False,
            #是否支持定时发布
            "schedule": False
        }
    },
    "sohu": {
        "type": 10,
        "platform_name": "sohu",
        "personal_url": "https://mp.sohu.com/mpfe/v4/contentManagement/first/page",
        "login_url": "https://mp.sohu.com/mpfe/v4/login",
        "creator_video_url": "https://mp.sohu.com/mpfe/v4/contentManagement/news/addvideo",
        "creator_image_url": "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle",
        "selectors": {
            "upload_button": ['div.upload-area', 'button.ql-image'],
            "direct_file_input": ['input.chunkUploader-input[type="file"][name="video"]', '#new-file'],
            "account_name": ['.user-info .name'],
            "publish_button": [
                'li.publish-report-btn.positive-button.active:has-text("发布")',
                '[report-attr*="content-button-commit"]'
            ],
            "title_editor": ['input[placeholder="请输入标题（5-72字）"]', 'input.titleErrorInput[placeholder*="请输入标题"]'],
            "textbox_selectors": ['div.ql-editor', 'textarea.abstract-main-textarea[placeholder*="视频描述"]'],
            "thumbnail_button": ['div.cover-button .upload-file', 'div.cover-button'],
            "thumbnail_finish": ['button:has-text("确定")'],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False
        }
    },
    "toutiao_mp": {
        "type": 11,
        "platform_name": "toutiao_mp",
        "personal_url": "https://mp.toutiao.com/profile_v4/index",
        "login_url": "https://mp.toutiao.com/auth/page/login?redirect_url=JTJGcHJvZmlsZV92NCUyRmluZGV4",
        "creator_video_url": "https://mp.toutiao.com/profile_v4/xigua/upload-video",
        "creator_image_url": "https://mp.toutiao.com/profile_v4/graphic/publish",
        "creator_weitoutiao_url": "https://mp.toutiao.com/profile_v4/weitoutiao/publish",
        "selectors": {
            "upload_button": [
                "div.upload-video-trigger",
                "div.byte-upload.xigua-upload-video-trigger.upload-video-trigger-card.no-tip"
            ],
            "direct_file_input": ['input[type="file"][accept*="video"]'],
            "account_name": ['.auth-avator-name', 'a[href*="//www.toutiao.com/c/user/"]'],
            "publish_button": [
                'button.publish-btn.publish-btn-last:has-text("预览并发布")',
                'button.publish-content:has-text("发布")',
                'button:has-text("发布")'
            ],
            "article_publish_button": ['button.publish-btn.publish-btn-last:has-text("预览并发布")'],
            "weitoutiao_publish_button": ['button.publish-content:has-text("发布")'],
            "video_publish_button": [
                'button.action-footer-btn.submit:has-text("发布")',
                'button.byte-btn-primary.action-footer-btn.submit:has-text("发布")',
                'div.button-group button.action-footer-btn.submit:has-text("发布")'
            ],
            "title_editor": [
                'textarea[placeholder="请输入文章标题（2～30个字）"]',
                'input.xigua-input.show-limit.byte-input.byte-input-size-large[placeholder*="请输入 1～30 个字符"]',
                'input[placeholder*="请输入 1～30 个字符"]',
                'input[placeholder*="1～30"]',
                '.form-item-title input'
            ],
            "article_title_editor": ['textarea[placeholder="请输入文章标题（2～30个字）"]'],
            "video_title_editor": [
                'input.xigua-input.show-limit.byte-input.byte-input-size-large[placeholder*="请输入 1～30 个字符"]',
                'input[placeholder*="请输入 1～30 个字符"]',
                'input[placeholder*="1～30"]',
                '.form-item-title input'
            ],
            "textbox_selectors": [
                'div.ProseMirror',
                'textarea.byte-textarea.abstract[placeholder*="请输入视频简介"]',
                'textarea[placeholder*="视频简介"]',
                '.form-item-abstract textarea'
            ],
            "article_textbox_selectors": ['div.ProseMirror'],
            "weitoutiao_textbox_selectors": ['div.ProseMirror'],
            "video_textbox_selectors": [
                'textarea.byte-textarea.abstract[placeholder*="请输入视频简介"]',
                'textarea[placeholder*="视频简介"]',
                '.form-item-abstract textarea'
            ],
            "topic_input": ['input.arco-input-tag-input.arco-input-tag-input-size-default[placeholder="请输入"]'],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": ['button:has-text("定时发布")'],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": True,
            "thumbnail": False,
            "location": False,
            "schedule": False
        }
    },
    "wechat_official": {
        "type": 12,
        "platform_name": "wechat_official",
        "personal_url": "https://mp.weixin.qq.com/",
        "login_url": "https://mp.weixin.qq.com/cgi-bin/loginpage?t=wxm2-login&lang=zh_CN",
        "creator_video_url": "https://mp.weixin.qq.com/",
        "creator_image_url": "https://mp.weixin.qq.com/",
        "selectors": {
            "upload_button": ['li#js_editor_insertimage'],
            "direct_file_input": ['li#js_editor_insertimage input[type="file"]'],
            "account_name": [
                '.weui-desktop-account__nickname',
                '.appmsg_account_name',
                '.weui-desktop-account__type'
            ],
            "draft_button": [
                'button:has-text("保存为草稿")',
                'button:has-text("保存草稿")',
                'button.weui-desktop-btn:has-text("保存为草稿")',
                'button.weui-desktop-btn:has-text("保存草稿")'
            ],
            "publish_button": ['button.mass_send', 'button:has-text("发表")'],
            "article_publish_button": ['button.mass_send', 'button:has-text("发表")'],
            "title_editor": ['textarea#title', '#title'],
            "article_title_editor": ['textarea#title', '#title'],
            "textbox_selectors": ['div.ProseMirror[contenteditable="true"]'],
            "article_textbox_selectors": ['div.ProseMirror[contenteditable="true"]'],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False
        }
    },
    "csdn": {
        "type": 13,
        "platform_name": "csdn",
        "personal_url": "https://mp.csdn.net/mp_blog/manage/article",
        "login_url": "https://passport.csdn.net/login?code=applets",
        "creator_video_url": "https://editor.csdn.net/md/",
        "creator_image_url": "https://editor.csdn.net/md/",
        "selectors": {
            "upload_button": ['button[data-title*="图片"]'],
            "direct_file_input": ['input[type="file"][accept*="image/"]'],
            "account_name": [
                'a.csdn-profile-avatar[href*="blog.csdn.net/"]',
                'a.hasAvatar[href*="blog.csdn.net/"]'
            ],
            "draft_button": [
                'button.btn.btn-save',
                '.save-opt-box .btn-link:has-text("保存草稿")'
            ],
            "publish_button": ['button.btn.btn-publish'],
            "article_publish_button": ['button.btn.btn-publish'],
            "title_editor": ['input.article-bar__title--input', 'input.article-bar__title--input[placeholder*="请输入文章标题"]'],
            "article_title_editor": ['input.article-bar__title--input', 'input.article-bar__title--input[placeholder*="请输入文章标题"]'],
            "textbox_selectors": ['pre.editor__inner[contenteditable="true"]'],
            "article_textbox_selectors": ['pre.editor__inner[contenteditable="true"]'],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False
        }
    },
    "jianshu": {
        "type": 14,
        "platform_name": "jianshu",
        "personal_url": "https://www.jianshu.com/writer",
        "login_url": "https://www.jianshu.com/sign_in",
        "creator_video_url": "https://www.jianshu.com/writer",
        "creator_image_url": "https://www.jianshu.com/writer",
        "selectors": {
            "upload_button": ['a[data-action="openImageModal"]'],
            "direct_file_input": ['#kalamu-upload-image', 'input[type="file"]#kalamu-upload-image'],
            "account_name": [],
            "login_success": [
                'div._1GsW5',
                'input._24i7u',
                'input[placeholder*="标题"]',
                'div.kalamu-area[contenteditable="true"]'
            ],
            "publish_button": [
                'text="发布文章"',
                'text=发布文章',
                'a:has-text("发布文章")',
                'button:has-text("发布文章")',
                '[role="button"]:has-text("发布文章")',
                '[title="发布文章"]',
                '[aria-label="发布文章"]',
                '[data-original-title="发布文章"]',
                'a[data-action="publicize"]',
                'a:has-text("发布")',
                'button:has-text("发布")',
                '[role="button"]:has-text("发布")',
            ],
            "article_publish_button": [
                'text="发布文章"',
                'text=发布文章',
                'a:has-text("发布文章")',
                'button:has-text("发布文章")',
                '[role="button"]:has-text("发布文章")',
                '[title="发布文章"]',
                '[aria-label="发布文章"]',
                '[data-original-title="发布文章"]',
                'a[data-action="publicize"]',
                'a:has-text("发布")',
                'button:has-text("发布")',
                '[role="button"]:has-text("发布")',
            ],
            "draft_button": [],
            "title_editor": ['input._24i7u', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
            "article_title_editor": ['input._24i7u', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
            "textbox_selectors": ['div.kalamu-area[contenteditable="true"]'],
            "article_textbox_selectors": ['div.kalamu-area[contenteditable="true"]'],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN"
        }
    },
    "zhihu": {
        "type": 15,
        "platform_name": "zhihu",
        "personal_url": "https://zhuanlan.zhihu.com/write",
        "login_url": "https://www.zhihu.com/signin?next=http%3A%2F%2Fzhuanlan.zhihu.com%2Fwrite",
        "creator_video_url": "https://zhuanlan.zhihu.com/write",
        "creator_image_url": "https://zhuanlan.zhihu.com/write",
        "selectors": {
            "upload_button": ['button[aria-label="图片"]'],
            "direct_file_input": [
                'input[type="file"][accept*="image/webp"]',
                'input[type="file"][accept="image/*"]'
            ],
            "account_name": [
                'button.AppHeader-profileEntry img[alt]',
                '.AppHeader-profileEntry img[alt]'
            ],
            "login_success": [
                'textarea[placeholder*="请输入标题"]',
                'button.AppHeader-profileEntry img[alt]',
                '.AppHeader-profileEntry img[alt]'
            ],
            "publish_button": ['button:has-text("发布")'],
            "article_publish_button": ['button:has-text("发布")'],
            "draft_button": [],
            "title_editor": ['textarea[placeholder*="请输入标题"]'],
            "article_title_editor": ['textarea[placeholder*="请输入标题"]'],
            "textbox_selectors": ['div.public-DraftEditor-content[contenteditable="true"]'],
            "article_textbox_selectors": ['div.public-DraftEditor-content[contenteditable="true"]'],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ],
            "manual_verification": True
        }
    },
    "x": {
        "type": 16,
        "platform_name": "x",
        "personal_url": "https://x.com/home",
        "login_url": "https://x.com/i/flow/login",
        "creator_video_url": "https://x.com/compose/post",
        "creator_image_url": "https://x.com/compose/post",
        "selectors": {
            "upload_button": ['[data-testid="fileInput"]'],
            "direct_file_input": ['[data-testid="fileInput"]', 'input[data-testid="fileInput"]'],
            "account_name": [
                '[data-testid="SideNav_AccountSwitcher_Button"]',
                'button[data-testid="SideNav_AccountSwitcher_Button"]'
            ],
            "login_success": [
                '[data-testid="SideNav_NewTweet_Button"]',
                '[data-testid="AppTabBar_Home_Link"]',
                '[data-testid="primaryColumn"]'
            ],
            "publish_button": ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'],
            "article_publish_button": ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'],
            "draft_button": [],
            "title_editor": [],
            "article_title_editor": [],
            "textbox_selectors": [
                '[data-testid="tweetTextarea_0"]',
                'div[role="textbox"][data-testid="tweetTextarea_0"]',
                'div[role="textbox"][aria-label*="Post text"]',
                'div[role="textbox"][aria-label*="What is happening"]'
            ],
            "article_textbox_selectors": [
                '[data-testid="tweetTextarea_0"]',
                'div[role="textbox"][data-testid="tweetTextarea_0"]',
                'div[role="textbox"][aria-label*="Post text"]',
                'div[role="textbox"][aria-label*="What is happening"]'
            ],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "browser_lang": "en-US",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "weibo": {
        "type": 17,
        "platform_name": "weibo",
        "personal_url": "https://weibo.com/",
        "login_url": "https://weibo.com/",
        "creator_video_url": "https://weibo.com/",
        "creator_image_url": "https://weibo.com/",
        "creator_article_url": "https://card.weibo.com/article/v5/editor#/draft",
        "selectors": {
            "upload_button": [
                'span:has-text("图片")',
                'span:has-text("视频")'
            ],
            "direct_file_input": [
                'input[type="file"][accept*="image"]',
                'input[type="file"][accept*="video"]',
                'input[type="file"]'
            ],
            "account_name": [
                'a[href^="/u/"][title]',
                'a[href*="//weibo.com/u/"][aria-label]',
                '[class*="name"]'
            ],
            "login_success": [
                'textarea[placeholder*="新鲜事"]',
                'textarea[placeholder="请输入标题"]',
                'textarea[placeholder*="分享"]',
                'button:has-text("发送")'
            ],
            "publish_button": ['button:has-text("发送")'],
            "article_publish_button": [
                'button:has-text("发布")',
                'button:has-text("发表")',
                'button:has-text("下一步")'
            ],
            "draft_button": ['button:has-text("保存草稿")'],
            "title_editor": ['textarea[placeholder*="新鲜事"]'],
            "article_title_editor": ['textarea[placeholder="请输入标题"]'],
            "article_lead_editor": ['textarea[placeholder*="导语"]'],
            "textbox_selectors": [
                'textarea[placeholder*="新鲜事"]',
                'textarea[placeholder*="分享"]'
            ],
            "article_textbox_selectors": [
                'div.ProseMirror[contenteditable="true"]'
            ],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ],
            "manual_verification": True
        }
    },
    "douban": {
        "type": 18,
        "platform_name": "douban",
        "personal_url": "https://www.douban.com/",
        "login_url": "https://www.douban.com/",
        "creator_video_url": "https://www.douban.com/",
        "creator_image_url": "https://www.douban.com/",
        "creator_article_url": "https://www.douban.com/note/create",
        "selectors": {
            "upload_button": [],
            "direct_file_input": [
                'input[type="file"][accept*="image"]',
                'input[type="file"]'
            ],
            "account_name": [
                'a.bn-more',
                '.nav-account .bn-more'
            ],
            "login_success": [
                'div.DRE-inputor.DRE-root[contenteditable="true"]',
                'text=此刻你想要分享...',
                'button:has-text("发布")'
            ],
            "publish_button": ['button:has-text("发布")'],
            "article_publish_button": ['button:has-text("发布")'],
            "draft_button": [],
            "title_editor": [],
            "article_title_editor": ['textarea[placeholder="请输入标题"]'],
            "textbox_selectors": [
                'div.DRE-inputor.DRE-root[contenteditable="true"]',
                'div[role="textbox"][contenteditable="true"][aria-placeholder*="此刻你想要分享"]'
            ],
            "article_textbox_selectors": [
                'div.DRE-inputor.DRE-root[contenteditable="true"]',
                'div[role="textbox"][contenteditable="true"][aria-placeholder*="此刻你想要分享"]'
            ],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "tieba": {
        "type": 19,
        "platform_name": "tieba",
        "personal_url": "https://tieba.baidu.com/index.html",
        "login_url": "https://tieba.baidu.com/index.html",
        "creator_video_url": "https://tieba.baidu.com/index.html",
        "creator_image_url": "https://tieba.baidu.com/index.html",
        "selectors": {
            "upload_button": [
                '.edui-btn.edui-btn-image',
                '.edui-for-image'
            ],
            "direct_file_input": [
                '.poster_editor input[type="file"]',
                '.edui-dialog input[type="file"]',
                'input[type="file"]'
            ],
            "account_name": [
                '.u_username_wrap',
                '.userinfo_username',
                'a[username]'
            ],
            "login_success": [
                '.u_username_wrap',
                '.add_thread_btn.post_head_btn',
                'input.j_title'
            ],
            "publish_button": [
                '.btn_default.btn_middle.j_submit.poster_submit',
                '.j_submit'
            ],
            "article_publish_button": [
                '.btn_default.btn_middle.j_submit.poster_submit',
                '.j_submit'
            ],
            "draft_button": [],
            "title_editor": [
                'input.j_title',
                '.editor_textfield.j_title'
            ],
            "article_title_editor": [
                'input.j_title',
                '.editor_textfield.j_title'
            ],
            "textbox_selectors": [
                'div.edui-body-container[contenteditable="true"]',
                '.edui-body-container'
            ],
            "article_textbox_selectors": [
                'div.edui-body-container[contenteditable="true"]',
                '.edui-body-container'
            ],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "omqq": {
        "type": 20,
        "platform_name": "omqq",
        "personal_url": "https://om.qq.com/main",
        "login_url": "https://om.qq.com/main/creation/article",
        "creator_video_url": "https://om.qq.com/main/creation/video",
        "creator_image_url": "https://om.qq.com/main/creation/article",
        "creator_article_url": "https://om.qq.com/main/creation/article",
        "selectors": {
            "upload_button": [
                'exeditor-toolbar-button[data-toolbar-item-of="imagePlugin"]'
            ],
            "direct_file_input": [
                '.omui-dialog input[type="file"][accept*="image/"]',
                '.omui-dialog input[type="file"]'
            ],
            "account_name": [
                'li[class*="user"] [class*="usernameText"]',
                'span[class*="usernameText"]'
            ],
            "login_success": [
                'li[class*="user"] [class*="usernameText"]',
                '.omui-articletitle__input1 .omui-inputautogrowing__inner',
                'div.ProseMirror.ExEditor-basic[contenteditable="true"]'
            ],
            "publish_button": [
                'button:has-text("发布")'
            ],
            "article_publish_button": [
                'button:has-text("发布")'
            ],
            "draft_button": [
                'button:has-text("存草稿")'
            ],
            "title_editor": [
                '.omui-articletitle__input1 .omui-inputautogrowing__inner'
            ],
            "article_title_editor": [
                '.omui-articletitle__input1 .omui-inputautogrowing__inner'
            ],
            "textbox_selectors": [
                'div.ProseMirror.ExEditor-basic[contenteditable="true"]',
                '.ProseMirror.ExEditor-basic'
            ],
            "article_textbox_selectors": [
                'div.ProseMirror.ExEditor-basic[contenteditable="true"]',
                '.ProseMirror.ExEditor-basic'
            ],
            "thumbnail_button": [
                'button.addCoverBtn-cls3gyHX'
            ],
            "thumbnail_finish": [
                'button:has-text("确认")'
            ],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "wangyi_mp": {
        "type": 21,
        "platform_name": "wangyi_mp",
        "personal_url": "https://mp.163.com/subscribe_v4/index.html#/article-publish",
        "login_url": "https://mp.163.com/subscribe_v4/index.html#/article-publish",
        "creator_video_url": "https://mp.163.com/subscribe_v4/index.html#/article-publish",
        "creator_image_url": "https://mp.163.com/subscribe_v4/index.html#/article-publish",
        "creator_article_url": "https://mp.163.com/subscribe_v4/index.html#/article-publish",
        "selectors": {
            "upload_button": [
                'button.rich-editor-panel-item:has(img[src*="icon_image"])'
            ],
            "direct_file_input": [
                'input[type="file"][accept*="image/gif"]'
            ],
            "login_success": [
                'textarea[placeholder="请输入标题 (5~30个字)"]',
                'div.public-DraftEditor-content[contenteditable="true"]'
            ],
            "publish_button": [
                'button.primary_button:has-text("发布")'
            ],
            "article_publish_button": [
                'button.primary_button:has-text("发布")'
            ],
            "draft_button": [],
            "title_editor": [
                'textarea[placeholder="请输入标题 (5~30个字)"]'
            ],
            "article_title_editor": [
                'textarea[placeholder="请输入标题 (5~30个字)"]'
            ],
            "textbox_selectors": [
                'div.public-DraftEditor-content[contenteditable="true"]',
                '.public-DraftEditor-content'
            ],
            "article_textbox_selectors": [
                'div.public-DraftEditor-content[contenteditable="true"]',
                '.public-DraftEditor-content'
            ],
            "thumbnail_button": [],
            "thumbnail_finish": [],
            "schedule_button": [],
            "date_input": [],
            "time_input": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "login_stealth": False,
            "image_publish": True,
            "title": True,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "doubao": {
        "type": 22,
        "platform_name": "doubao",
        "auth_cookie_names": [
            "sessionid",
            "sessionid_ss",
            "sid_tt",
            "uid_tt",
            "uid_tt_ss",
        ],
        "personal_url": "https://www.doubao.com/chat/",
        "login_url": "https://www.doubao.com/chat/",
        "creator_video_url": "https://www.doubao.com/chat/",
        "creator_image_url": "https://www.doubao.com/chat/",
        "selectors": {
            "login_required": [
                'button:has-text("登录")',
                'text=登录',
                'text=手机号登录',
                'text=扫码登录',
                'text=立即登录',
            ],
            "login_success": [
                'textarea',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"][data-slate-editor="true"]',
                'div[contenteditable="true"][data-lexical-editor="true"]',
            ],
            "monitor_input": [
                'textarea:not([disabled])',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"][data-slate-editor="true"]',
                'div[contenteditable="true"][data-lexical-editor="true"]',
                'div[contenteditable="true"]',
            ],
            "monitor_send": [
                'button:has-text("发送")',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                '[data-testid*="send"]',
            ],
            "monitor_response": [
                '[class*="markdown"]',
                '[class*="message-content"]',
                '[class*="message"]',
                '[class*="assistant"]',
                '[data-testid*="message"]',
                'article',
            ],
            "monitor_new_chat": [
                'button:has-text("新对话")',
                'button:has-text("开启新对话")',
                'button:has-text("新建聊天")',
                'a:has-text("新对话")',
            ],
            "account_name": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "qianwen": {
        "type": 23,
        "platform_name": "qianwen",
        "auth_cookie_names": [
            "login_tongyi_ticket",
            "login_aliyunid",
            "tongyi_sso_ticket",
            "tongyi_sso_ticket_hash",
            "b-user-id",
        ],
        "personal_url": "https://www.qianwen.com/chat",
        "login_url": "https://www.qianwen.com/chat",
        "creator_video_url": "https://www.qianwen.com/chat",
        "creator_image_url": "https://www.qianwen.com/chat",
        "selectors": {
            "login_required": [
                'button:has-text("登录")',
                'text=立即登录',
                'text=扫码登录',
                'text=手机号登录',
                'text=去登录',
            ],
            "login_success": [
                'textarea',
                'textarea[class*="textarea"]',
                'div[contenteditable="true"][role="textbox"]',
            ],
            "monitor_input": [
                'textarea:not([disabled])',
                'textarea[class*="textarea"]:not([disabled])',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
            ],
            "monitor_send": [
                'button:has-text("发送")',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                '[data-testid*="send"]',
            ],
            "monitor_response": [
                '[class*="answerItem"]',
                '[class*="textContent"]',
                '[class*="stream"]',
            ],
            "monitor_new_chat": [
                'button:has-text("新对话")',
                'button:has-text("新建对话")',
                'button:has-text("开启新对话")',
                'button:has-text("新会话")',
                '[class*="addBtn"]',
            ],
            "account_name": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "yuanbao": {
        "type": 24,
        "platform_name": "yuanbao",
        "auth_cookie_names": [],
        "personal_url": "https://yuanbao.tencent.com/",
        "login_url": "https://yuanbao.tencent.com/",
        "creator_video_url": "https://yuanbao.tencent.com/",
        "creator_image_url": "https://yuanbao.tencent.com/",
        "selectors": {
            "login_required": [
                'button:has-text("Log In")',
                'button:has-text("登录")',
                'text=Not logged in',
                'text=未登录',
                'text=Login with WeChat QR Code',
                'text=微信扫码登录',
            ],
            "login_success": [],
            "monitor_input": [
                'div.ql-editor[contenteditable="true"]',
                'div[class*="ql-editor"][contenteditable="true"]',
                'div[contenteditable="true"][class*="editor"]',
                'div[contenteditable="true"]',
            ],
            "monitor_send": [
                'a[class*="send-btn"]:not([class*="disabled"])',
                'button[class*="send"]:not([disabled])',
                'button:has-text("发送")',
                'button:has-text("Send")',
            ],
            "monitor_response": [
                '[class*="message"]',
                '[class*="markdown"]',
                '[class*="answer"]',
                '[class*="agent"]',
                'article',
            ],
            "monitor_new_chat": [
                'button:has-text("New Chat")',
                'button:has-text("新对话")',
                'a:has-text("New Chat")',
                'a:has-text("新对话")',
                '[class*="new-chat"]',
            ],
            "account_name": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "yiyan": {
        "type": 25,
        "platform_name": "yiyan",
        "auth_cookie_names": [
            "BDUSS",
            "BDUSS_BFESS",
            "STOKEN",
            "PTOKEN",
        ],
        "personal_url": "https://chat.baidu.com/?enter_type=home_operate",
        "login_url": "https://chat.baidu.com/?enter_type=home_operate",
        "creator_video_url": "https://chat.baidu.com/?enter_type=home_operate",
        "creator_image_url": "https://chat.baidu.com/?enter_type=home_operate",
        "selectors": {
            "login_required": [
                'button:has-text("登录")',
                'text=请登录',
                'text=登录同步历史对话',
                'text=扫码登录',
                'text=百度账号登录',
            ],
            "login_success": [
                'textarea.ci-textarea:not([disabled])',
                'textarea:not([disabled])',
                '.chat-aside-user-info',
            ],
            "monitor_input": [
                'textarea.ci-textarea:not([disabled])',
                'textarea:not([disabled])',
            ],
            "monitor_send": [
                '.send__slzHSuja',
                '.btnContainer__sFTJytvZ',
                '.sendInner__xGu8iz1q',
                'button:has-text("发送")',
                'button[aria-label*="发送"]',
                'button[class*="send"]:not([disabled])',
                '[role="button"][aria-label*="发送"]',
            ],
            "monitor_response": [
                '.chat-search-answer-generate',
                '.ai-markdown',
                '.cosd-markdown',
                '.cosd-markdown-content',
                '[class*="answer"]',
                '[class*="markdown"]',
            ],
            "monitor_new_chat": [
                'button:has-text("开启新对话")',
                'a:has-text("开启新对话")',
                'text=开启新对话',
                'button:has-text("新对话")',
                'a:has-text("新对话")',
                'text=新对话',
            ],
            "account_name": [
                '.chat-aside-user-info',
            ],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "kimi": {
        "type": 26,
        "platform_name": "kimi",
        "auth_cookie_names": [],
        "personal_url": "https://www.kimi.com/",
        "login_url": "https://www.kimi.com/",
        "creator_video_url": "https://www.kimi.com/",
        "creator_image_url": "https://www.kimi.com/",
        "selectors": {
            "login_required": [
                'button:has-text("登录")',
                'text=扫码登录',
                'text=微信扫码登录',
                'text=手机号登录',
                'text=手机号快捷登录',
                'text=验证码登录',
                'text=发送验证码',
                'text=继续使用手机号',
                'text=登录后继续',
                'text=登录以同步历史会话',
                'text=已阅读同意',
            ],
            "login_success": [
                'textarea:not([disabled])',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
            ],
            "monitor_input": [
                'textarea:not([disabled])',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
            ],
            "monitor_send": [
                'button:has-text("发送")',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[class*="send"]:not([disabled])',
                '[role="button"][aria-label*="发送"]',
                '[data-testid*="send"]',
            ],
            "monitor_response": [
                '[class*="message"]',
                '[class*="markdown"]',
                '[class*="answer"]',
                '[class*="response"]',
                '[class*="content"]',
                'article',
            ],
            "monitor_new_chat": [
                'button:has-text("新对话")',
                'button:has-text("新建对话")',
                'button:has-text("开启新对话")',
                'button:has-text("New Chat")',
                'a:has-text("新对话")',
                'a:has-text("New Chat")',
                'text=新对话',
            ],
            "account_name": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "deepseek": {
        "type": 27,
        "platform_name": "deepseek",
        "auth_cookie_names": [],
        "personal_url": "https://chat.deepseek.com/",
        "login_url": "https://chat.deepseek.com/",
        "creator_video_url": "https://chat.deepseek.com/",
        "creator_image_url": "https://chat.deepseek.com/",
        "selectors": {
            "login_required": [
                'button:has-text("登录")',
                'button:has-text("立即登录")',
                'text=扫码登录',
                'text=手机号登录',
                'text=验证码登录',
                'text=发送验证码',
                'text=登录后使用更多功能',
                'text=登录后继续',
                'text=请先登录',
            ],
            "login_success": [
                'textarea:not([disabled])',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
            ],
            "monitor_input": [
                'textarea:not([disabled])',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
            ],
            "monitor_send": [
                'button:has-text("发送")',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[class*="send"]:not([disabled])',
                '[role="button"][aria-label*="发送"]',
                '[data-testid*="send"]',
            ],
            "monitor_response": [
                '[class*="message"]',
                '[class*="markdown"]',
                '[class*="answer"]',
                '[class*="response"]',
                '[class*="content"]',
                'article',
            ],
            "monitor_new_chat": [
                'button:has-text("新对话")',
                'button:has-text("新建对话")',
                'button:has-text("开启新对话")',
                'button:has-text("New Chat")',
                'a:has-text("新对话")',
                'a:has-text("New Chat")',
                'text=新对话',
            ],
            "account_name": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "zhipu": {
        "type": 28,
        "platform_name": "zhipu",
        "auth_cookie_names": [],
        "personal_url": "https://chatglm.cn/",
        "login_url": "https://chatglm.cn/",
        "creator_video_url": "https://chatglm.cn/",
        "creator_image_url": "https://chatglm.cn/",
        "selectors": {
            "login_required": [
                'text=扫码登录',
                'text=手机验证码登录',
                'text=请输入手机号',
                'text=登录 / 注册',
            ],
            "login_success": [
                'textarea:not([disabled])',
                '[class*="chatScrollContainer"]',
                '[class*="conversation-list"]',
            ],
            "monitor_input": [
                'textarea:not([disabled])',
                'div[role="textbox"][contenteditable="true"]',
                'div[contenteditable="true"]',
            ],
            "monitor_send": [
                'button:has-text("发送")',
                'button[aria-label*="发送"]',
                'button[aria-label*="Send"]',
                'button[class*="send"]:not([disabled])',
                '[role="button"][aria-label*="发送"]',
                '[data-testid*="send"]',
            ],
            "monitor_response": [
                '[class*="answer-content-wrap"]',
                '[class*="markdown"]',
                '[class*="answer-content"]',
                '[class*="answer"]',
                '[class*="chatScrollContainer"]',
                '[class*="conversation-list"]',
            ],
            "monitor_new_chat": [
                'button:has-text("新对话")',
                'button:has-text("开启新对话")',
                'a:has-text("新对话")',
                'text=新对话',
            ],
            "account_name": [],
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": True,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    },
    "douyin_ai": {
        "type": 29,
        "platform_name": "douyin_ai",
        "auth_cookie_names": [
            "sessionid",
            "sessionid_ss",
            "sid_tt",
            "uid_tt",
            "uid_tt_ss",
            "ttwid",
            "passport_auth_mix_state"
        ],
        "personal_url": "https://www.douyin.com/aisearch",
        "login_url": "https://www.douyin.com/aisearch",
        "creator_video_url": "https://www.douyin.com/aisearch",
        "creator_image_url": "https://www.douyin.com/aisearch",
        "selectors": {
            "login_required": [
                'button:has-text("登录")',
                'text=登录',
                'text=扫码登录',
                'text=立即登录'
            ],
            "login_success": [
                'iframe[src*="search_ai_mobile/pc"]',
                'div#input_ai_search[contenteditable="true"]'
            ],
            "monitor_input": [
                'div#input_ai_search[contenteditable="true"]'
            ],
            "monitor_send": [],
            "monitor_response": [
                '.flow-markdown-body',
                '[class*="markdown"]',
                '[class*="cardWrapper"]'
            ],
            "monitor_new_chat": [],
            "account_name": []
        },
        "features": {
            "skip_cookie_verify": True,
            "image_publish": False,
            "title": False,
            "textbox": True,
            "tags": False,
            "thumbnail": False,
            "location": False,
            "schedule": False,
            "stealth": False,
            "strict_login_check": False,
            "browser_lang": "zh-CN",
            "browser_args": [
                "--start-maximized"
            ],
            "login_browser_args": [
                "--start-maximized"
            ]
        }
    }
}

# 导出配置以便其他模块导入
__all__ = ['PLATFORM_CONFIGS', 'get_platform_key_by_type', 'get_type_by_platform_key']


def get_platform_key_by_type(type):
    """
    通过平台类型编号查找平台key
    :param type: 平台类型编号
    :return: 平台key，如果没有找到则返回None
    """
    try:
        normalized_type = int(type)
    except (TypeError, ValueError):
        normalized_type = type
    for platform_key, config in PLATFORM_CONFIGS.items():
        if config['type'] == normalized_type:
            return platform_key
    return None


def get_type_by_platform_key(platform_key):
    """
    通过平台key查找平台类型编号
    :param platform_key: 平台key
    :return: 平台类型编号，如果没有找到则返回None
    """
    config = PLATFORM_CONFIGS.get(platform_key)
    if config:
        return config['type']
    return None
